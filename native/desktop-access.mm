#include <node_api.h>
#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <Security/Security.h>


// Keep the native alert on Electron's normal application loop so app quit and
// keyboard/menu commands are never blocked by a separate AppKit modal session.
static NSAlert *activationAlert;
static NSTextField *activationInput;

@interface MatterActivationActions : NSObject <NSTextFieldDelegate>
@property(nonatomic) BOOL editable;
@property(nonatomic) NSModalResponse response;
- (void)refresh;
@end
@implementation MatterActivationActions
- (void)confirm:(id)sender { self.response = NSAlertFirstButtonReturn; }
- (void)quit:(id)sender { self.response = NSAlertSecondButtonReturn; }
- (void)controlTextDidChange:(NSNotification *)notification {
  [self refresh];
}
- (void)refresh {
  NSString *code = [activationInput.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  activationAlert.buttons.firstObject.enabled = self.editable &&
    [code rangeOfString:@"^[A-HJ-NP-Z2-9]{6}$" options:NSRegularExpressionSearch | NSCaseInsensitiveSearch].location != NSNotFound;
}
@end
static MatterActivationActions *activationActions;

static void dismissActivationPrompt() {
  [activationAlert.window orderOut:nil];
  activationInput.delegate = nil;
  activationAlert = nil; activationInput = nil; activationActions = nil;
}

static napi_value fail(napi_env env, const char *code, const char *message) {
  napi_throw_error(env, code, message); return nullptr;
}
static napi_value keyError(napi_env env, OSStatus status) {
  const char *code = status == errSecInteractionNotAllowed ? "keychain_locked" :
    status == errSecMissingEntitlement || status == errSecNotAvailable ? "secure_key_unsupported" : "keychain_error";
  return fail(env, code, "macOS could not access the device activation key");
}
static NSData *tagArgument(napi_env env, napi_value value) {
  size_t size = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok || size < 40 || size > 160) return nil;
  char text[161];
  if (napi_get_value_string_utf8(env, value, text, sizeof(text), &size) != napi_ok) return nil;
  NSString *tag = [[NSString alloc] initWithBytes:text length:size encoding:NSUTF8StringEncoding];
  if (![tag hasPrefix:@"com.minduck.matter.desktop-access.v1."]) return nil;
  return [tag dataUsingEncoding:NSUTF8StringEncoding];
}
static SecKeyRef findKey(NSData *tag, bool create, OSStatus *status) {
  NSDictionary *query = @{(__bridge id)kSecClass:(__bridge id)kSecClassKey,
    (__bridge id)kSecAttrApplicationTag:tag,
    (__bridge id)kSecAttrKeyType:(__bridge id)kSecAttrKeyTypeECSECPrimeRandom,
    (__bridge id)kSecUseDataProtectionKeychain:@YES,
    (__bridge id)kSecReturnRef:@YES};
  CFTypeRef found = nullptr;
  *status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &found);
  if (*status == errSecSuccess) return (SecKeyRef)found;
  if (*status != errSecItemNotFound || !create) return nullptr;
  CFErrorRef error = nullptr;
  SecAccessControlRef access = SecAccessControlCreateWithFlags(kCFAllocatorDefault,
    kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, kSecAccessControlPrivateKeyUsage, &error);
  if (!access) { if (error) CFRelease(error); *status = errSecNotAvailable; return nullptr; }
  NSDictionary *attributes = @{(__bridge id)kSecAttrKeyType:(__bridge id)kSecAttrKeyTypeECSECPrimeRandom,
    (__bridge id)kSecAttrKeySizeInBits:@256,
    (__bridge id)kSecAttrTokenID:(__bridge id)kSecAttrTokenIDSecureEnclave,
    (__bridge id)kSecUseDataProtectionKeychain:@YES,
    (__bridge id)kSecPrivateKeyAttrs:@{(__bridge id)kSecAttrIsPermanent:@YES,
      (__bridge id)kSecAttrApplicationTag:tag, (__bridge id)kSecAttrAccessControl:(__bridge id)access}};
  SecKeyRef key = SecKeyCreateRandomKey((__bridge CFDictionaryRef)attributes, &error);
  CFRelease(access);
  *status = key ? errSecSuccess : error ? (OSStatus)CFErrorGetCode(error) : errSecNotAvailable;
  if (error) CFRelease(error);
  return key;
}
static napi_value publicKey(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count = 2; napi_value args[2]; bool create = false;
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    if (count != 2 || napi_get_value_bool(env, args[1], &create) != napi_ok) return fail(env,"invalid_argument","Expected tag and create flag");
    NSData *tag = tagArgument(env,args[0]); if (!tag) return fail(env,"invalid_argument","Invalid activation key tag");
    OSStatus status; SecKeyRef key = findKey(tag,create,&status);
    if (!key) { if (status == errSecItemNotFound) {napi_value value; napi_get_null(env,&value);return value;} return keyError(env,status); }
    SecKeyRef pub = SecKeyCopyPublicKey(key); CFRelease(key);
    if (!pub) return keyError(env,errSecNotAvailable);
    CFErrorRef error = nullptr; CFDataRef data = SecKeyCopyExternalRepresentation(pub,&error); CFRelease(pub);
    if (!data) { if(error)CFRelease(error); return keyError(env,errSecNotAvailable); }
    napi_value value; napi_create_buffer_copy(env,CFDataGetLength(data),CFDataGetBytePtr(data),nullptr,&value);CFRelease(data);return value;
  }
}
static napi_value sign(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count=2; napi_value args[2];void *bytes=nullptr;size_t size=0;
    napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
    if(count!=2||napi_get_buffer_info(env,args[1],&bytes,&size)!=napi_ok||size==0||size>2048) return fail(env,"invalid_argument","Expected restricted protocol data");
    NSData *tag=tagArgument(env,args[0]);if(!tag)return fail(env,"invalid_argument","Invalid activation key tag");
    const char *prefix="matter-desktop-access-v1\n";
    if(size<strlen(prefix)||memcmp(bytes,prefix,strlen(prefix))!=0)return fail(env,"invalid_argument","Unsupported signing protocol");
    OSStatus status;SecKeyRef key=findKey(tag,false,&status);if(!key)return keyError(env,status);
    CFDataRef input=CFDataCreate(kCFAllocatorDefault,(const UInt8*)bytes,size);CFErrorRef error=nullptr;
    CFDataRef signature=SecKeyCreateSignature(key,kSecKeyAlgorithmECDSASignatureMessageX962SHA256,input,&error);
    CFRelease(input);CFRelease(key);
    if(!signature){OSStatus code=error?(OSStatus)CFErrorGetCode(error):errSecNotAvailable;if(error)CFRelease(error);return keyError(env,code);}
    napi_value value;napi_create_buffer_copy(env,CFDataGetLength(signature),CFDataGetBytePtr(signature),nullptr,&value);CFRelease(signature);return value;
  }
}

static NSString *promptText(napi_env env, napi_value value) {
  size_t size = 0;
  if (napi_get_value_string_utf8(env,value,nullptr,0,&size) != napi_ok || size > 8192) return nil;
  char text[8193];
  if (napi_get_value_string_utf8(env,value,text,sizeof(text),&size) != napi_ok) return nil;
  return [[NSString alloc] initWithBytes:text length:size encoding:NSUTF8StringEncoding];
}
static napi_value openPrompt(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count = 3; napi_value args[3]; bool editable;
    napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
    if (count != 3 || napi_get_value_bool(env,args[2],&editable) != napi_ok)
      return fail(env,"invalid_argument","Expected error, previous input and editable flag");
    NSString *error = promptText(env,args[0]), *code = promptText(env,args[1]);
    if (!error || !code) return fail(env,"invalid_argument","Invalid prompt text");
    if (![NSThread isMainThread] || !NSApp) return fail(env,"prompt_unavailable","Activation prompt requires the application main thread");
    if (activationAlert) return fail(env,"prompt_already_open","Activation prompt is already open");
    activationAlert = [[NSAlert alloc] init];
    activationAlert.messageText = @"输入邀请码以激活应用";
    activationAlert.informativeText = error.length
      ? [@"激活码为一次性产物，核销后作废！\n\n" stringByAppendingString:error]
      : @"激活码为一次性产物，核销后作废！";
    activationAlert.alertStyle = NSAlertStyleInformational;
    NSButton *confirm = [activationAlert addButtonWithTitle:@"确定"];
    NSButton *quit = [activationAlert addButtonWithTitle:@"退出"];
    activationActions = [[MatterActivationActions alloc] init];
    activationActions.editable = editable;
    activationActions.response = NSModalResponseContinue;
    NSView *accessory = [[NSView alloc] initWithFrame:NSMakeRect(0,0,300,62)];
    activationInput = [[NSTextField alloc] initWithFrame:NSMakeRect(0,34,300,24)];
    activationInput.stringValue = code;
    activationInput.enabled = editable;
    activationInput.delegate = activationActions;
    activationInput.accessibilityLabel = @"邀请码";
    [accessory addSubview:activationInput];
    NSTextField *note = [NSTextField labelWithString:@"没有邀请码？联系管理员提供。"];
    note.frame = NSMakeRect(0,0,300,20);
    note.font = [NSFont systemFontOfSize:NSFont.smallSystemFontSize];
    note.textColor = NSColor.secondaryLabelColor;
    [accessory addSubview:note];
    activationAlert.accessoryView = accessory;
    [activationActions refresh];
    [activationAlert layout];
    confirm.target = activationActions; confirm.action = @selector(confirm:); confirm.keyEquivalent = @"\r";
    quit.target = activationActions; quit.action = @selector(quit:); quit.keyEquivalent = @"\e";
    [activationAlert.window center];
    if (editable) [activationAlert.window setInitialFirstResponder:activationInput];
    [activationAlert.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    if (editable) [activationAlert.window makeFirstResponder:activationInput];
    napi_value value; napi_get_undefined(env,&value); return value;
  }
}
static napi_value pollPrompt(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    napi_value value;
    if (!activationAlert) { napi_get_null(env,&value); return value; }
    NSModalResponse response = activationActions.response;
    if (response == NSModalResponseContinue) { napi_get_null(env,&value); return value; }
    NSString *code = activationInput.stringValue;
    napi_create_object(env,&value);
    napi_value action, input;
    napi_create_string_utf8(env,response == NSAlertFirstButtonReturn ? "confirm" : "quit",NAPI_AUTO_LENGTH,&action);
    napi_create_string_utf8(env,code.UTF8String,NAPI_AUTO_LENGTH,&input);
    napi_set_named_property(env,value,"action",action); napi_set_named_property(env,value,"code",input);
    dismissActivationPrompt(); return value;
  }
}
static napi_value closePrompt(napi_env env, napi_callback_info info) {
  dismissActivationPrompt(); napi_value value; napi_get_undefined(env,&value); return value;
}
static napi_value updatePrompt(napi_env env, napi_callback_info info) {
  size_t count = 3; napi_value args[3]; bool editable, inputEnabled;
  napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
  if (count != 3 || napi_get_value_bool(env,args[1],&editable) != napi_ok ||
    napi_get_value_bool(env,args[2],&inputEnabled) != napi_ok)
    return fail(env,"invalid_argument","Expected error, confirm and input flags");
  NSString *error = promptText(env,args[0]);
  if (!error) return fail(env,"invalid_argument","Invalid prompt text");
  if (activationAlert) {
    BOOL restoreFocus = !activationInput.enabled && inputEnabled;
    activationAlert.informativeText = error.length
      ? [@"激活码为一次性产物，核销后作废！\n\n" stringByAppendingString:error]
      : @"激活码为一次性产物，核销后作废！";
    activationActions.editable = editable; activationInput.enabled = inputEnabled;
    [activationActions refresh]; [activationAlert layout];
    if (restoreFocus) [activationAlert.window makeFirstResponder:activationInput];
  }
  napi_value value; napi_get_undefined(env,&value); return value;
}
static napi_value focusPrompt(napi_env env, napi_callback_info info) {
  [activationAlert.window makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES];
  if (activationInput.enabled) [activationAlert.window makeFirstResponder:activationInput];
  napi_value value; napi_get_undefined(env,&value); return value;
}

NAPI_MODULE_INIT() {
  napi_property_descriptor properties[]={{"publicKey",nullptr,publicKey,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"sign",nullptr,sign,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"openPrompt",nullptr,openPrompt,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"pollPrompt",nullptr,pollPrompt,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"closePrompt",nullptr,closePrompt,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"updatePrompt",nullptr,updatePrompt,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"focusPrompt",nullptr,focusPrompt,nullptr,nullptr,nullptr,napi_default,nullptr}};
  napi_define_properties(env,exports,sizeof(properties)/sizeof(properties[0]),properties);return exports;
}

#include <node_api.h>
#import <Foundation/Foundation.h>
#import <Security/Security.h>

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
NAPI_MODULE_INIT() {
  napi_property_descriptor properties[]={{"publicKey",nullptr,publicKey,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"sign",nullptr,sign,nullptr,nullptr,nullptr,napi_default,nullptr}};
  napi_define_properties(env,exports,2,properties);return exports;
}

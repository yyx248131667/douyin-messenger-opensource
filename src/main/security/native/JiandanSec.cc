#include <napi.h>
#include <windows.h>
#include <string>
#include <vector>

// 5. Anti-debugging
Napi::Boolean CheckDebugger(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    bool isDebuggerPresent = IsDebuggerPresent();
    
    // Check PEB RemoteDebugger
    BOOL isRemoteDebuggerPresent = FALSE;
    CheckRemoteDebuggerPresent(GetCurrentProcess(), &isRemoteDebuggerPresent);
    
    return Napi::Boolean::New(env, isDebuggerPresent || isRemoteDebuggerPresent);
}

// 9. Hardware Lock via WMI/Registry
std::string GetHardwareId() {
    std::string hwid = "JD-SEC-";
    
    // Read BIOS SN
    HKEY hKey;
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, "HARDWARE\\DESCRIPTION\\System\\BIOS", 0, KEY_READ, &hKey) == ERROR_SUCCESS) {
        char value[255];
        DWORD BufferSize = 255;
        if (RegQueryValueExA(hKey, "SystemSerialNumber", NULL, NULL, (LPBYTE)value, &BufferSize) == ERROR_SUCCESS) {
            hwid += std::string(value) + "-";
        }
        RegCloseKey(hKey);
    }
    
    // Combine with MachineGuid
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, "SOFTWARE\\Microsoft\\Cryptography", 0, KEY_READ, &hKey) == ERROR_SUCCESS) {
        char value[255];
        DWORD BufferSize = 255;
        if (RegQueryValueExA(hKey, "MachineGuid", NULL, NULL, (LPBYTE)value, &BufferSize) == ERROR_SUCCESS) {
            hwid += std::string(value);
        }
        RegCloseKey(hKey);
    }

    if (hwid == "JD-SEC-") return "JD-SEC-FALLBACK-00000";
    return hwid;
}

Napi::String GetMachineCodeNative(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::String::New(env, GetHardwareId());
}

// 4. Memory-level security
Napi::Value EnforceSecurity(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (IsDebuggerPresent()) {
        // Crash the process intentionally
        int* ptr = nullptr;
        *ptr = 1; 
    }
    return env.Null();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "checkDebugger"), Napi::Function::New(env, CheckDebugger));
    exports.Set(Napi::String::New(env, "getMachineCodeNative"), Napi::Function::New(env, GetMachineCodeNative));
    exports.Set(Napi::String::New(env, "enforceSecurity"), Napi::Function::New(env, EnforceSecurity));
    return exports;
}

NODE_API_MODULE(JiandanSec, Init)

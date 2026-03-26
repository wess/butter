/*
 * Butter shim — Windows native window with WebView2
 * Pure C using Win32 + WebView2 COM interfaces
 *
 * Usage: shim.exe <shm-name> <html-path>
 * Env:   BUTTER_TITLE — window title (default: "Butter App")
 *
 * Compile (MSVC):  cl.exe windows.c /link ole32.lib user32.lib gdi32.lib shell32.lib shcore.lib WebView2Loader.lib
 * Compile (MinGW): gcc -o shim.exe windows.c -lole32 -luser32 -lgdi32 -lshell32 -lshcore -lWebView2Loader
 */

#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#define COBJMACROS
#define WIN32_LEAN_AND_MEAN

#include <windows.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <shellapi.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* GDI+ minimal headers for PNG encoding (used by screenshot) */
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "shcore.lib")

/* ---------- shared memory / IPC constants ---------- */

#define SHM_SIZE       (128 * 1024)
#define HEADER_SIZE    64
#define RING_SIZE      ((SHM_SIZE - HEADER_SIZE) / 2)
#define RING_TB_OFF    HEADER_SIZE
#define RING_TS_OFF    (HEADER_SIZE + RING_SIZE)
#define MSG_HDR        4

#define TB_WCUR  0
#define TB_RCUR  4
#define TS_WCUR  8
#define TS_RCUR  12

#define POLL_TIMER_ID  1
#define POLL_INTERVAL  16  /* ~60fps */

/* ---------- WebView2 COM GUIDs ---------- */

static const GUID IID_ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler =
    {0x4e8a3389, 0xc9d8, 0x4bd2, {0xb6, 0xba, 0x39, 0x50, 0xfd, 0x70, 0x86, 0x47}};
static const GUID IID_ICoreWebView2CreateCoreWebView2ControllerCompletedHandler =
    {0x6c4819f3, 0xc9b7, 0x4260, {0x81, 0x27, 0xc9, 0xf5, 0xbd, 0xe7, 0xf6, 0x8c}};
static const GUID IID_ICoreWebView2WebMessageReceivedEventHandler =
    {0x57213f19, 0x00e6, 0x49fa, {0x8e, 0x07, 0x89, 0x8e, 0xa0, 0x1e, 0xcb, 0xd2}};
static const GUID IID_ICoreWebView2NavigationCompletedEventHandler =
    {0xd33a35bf, 0x1c49, 0x4f98, {0x93, 0xab, 0x00, 0x6e, 0x05, 0x33, 0xfe, 0x1c}};

/* ---------- forward declarations for functions ---------- */

static int json_extract_string(const char *json, const char *key, char *out, size_t outlen);
static double json_extract_number(const char *json, const char *key, double fallback);
static wchar_t *escape_for_js(const char *json);
static wchar_t *utf8_to_wide(const char *utf8);
static char *wide_to_utf8(const wchar_t *wide);
static void handle_dialog_open(const char *msg);
static void handle_dialog_save(const char *msg);
static void handle_dialog_folder(const char *msg);
static void handle_dialog_message(const char *msg, int from_webview);
static void handle_webview_dialog(const char *msg);
static void handle_copydata(HWND hwnd, LPARAM lp);

/* forward declare handler-creation functions */
typedef struct ScriptCompletedHandler ScriptCompletedHandler;
typedef struct ControllerCreatedHandler ControllerCreatedHandler;
static ScriptCompletedHandler *create_execute_script_handler(void);
static ControllerCreatedHandler *create_controller_handler(void);

/* ---------- forward declarations for COM vtables ---------- */

/* We declare minimal COM interface structures needed for WebView2 in pure C.
 * Only methods we actually call have correct vtable slot positions;
 * the rest are void* placeholders. */

typedef struct ICoreWebView2 ICoreWebView2;
typedef struct ICoreWebView2Controller ICoreWebView2Controller;
typedef struct ICoreWebView2Environment ICoreWebView2Environment;
typedef struct ICoreWebView2Settings ICoreWebView2Settings;
typedef struct ICoreWebView2WebMessageReceivedEventArgs ICoreWebView2WebMessageReceivedEventArgs;
typedef struct ICoreWebView2NavigationCompletedEventArgs ICoreWebView2NavigationCompletedEventArgs;

/* EventRegistrationToken */
typedef struct { int64_t value; } EventRegistrationToken;

/* ---------- ICoreWebView2Settings vtable ---------- */

typedef struct ICoreWebView2SettingsVtbl {
    /* IUnknown */
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2Settings*, REFIID, void**);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2Settings*);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2Settings*);
    /* ICoreWebView2Settings */
    HRESULT (STDMETHODCALLTYPE *get_IsScriptEnabled)(ICoreWebView2Settings*, BOOL*);
    HRESULT (STDMETHODCALLTYPE *put_IsScriptEnabled)(ICoreWebView2Settings*, BOOL);
    HRESULT (STDMETHODCALLTYPE *get_IsWebMessageEnabled)(ICoreWebView2Settings*, BOOL*);
    HRESULT (STDMETHODCALLTYPE *put_IsWebMessageEnabled)(ICoreWebView2Settings*, BOOL);
    HRESULT (STDMETHODCALLTYPE *get_AreDefaultScriptDialogsEnabled)(ICoreWebView2Settings*, BOOL*);
    HRESULT (STDMETHODCALLTYPE *put_AreDefaultScriptDialogsEnabled)(ICoreWebView2Settings*, BOOL);
    HRESULT (STDMETHODCALLTYPE *get_IsStatusBarEnabled)(ICoreWebView2Settings*, BOOL*);
    HRESULT (STDMETHODCALLTYPE *put_IsStatusBarEnabled)(ICoreWebView2Settings*, BOOL);
    HRESULT (STDMETHODCALLTYPE *get_AreDevToolsEnabled)(ICoreWebView2Settings*, BOOL*);
    HRESULT (STDMETHODCALLTYPE *put_AreDevToolsEnabled)(ICoreWebView2Settings*, BOOL);
    HRESULT (STDMETHODCALLTYPE *get_AreDefaultContextMenusEnabled)(ICoreWebView2Settings*, BOOL*);
    HRESULT (STDMETHODCALLTYPE *put_AreDefaultContextMenusEnabled)(ICoreWebView2Settings*, BOOL);
    HRESULT (STDMETHODCALLTYPE *get_AreHostObjectsAllowed)(ICoreWebView2Settings*, BOOL*);
    HRESULT (STDMETHODCALLTYPE *put_AreHostObjectsAllowed)(ICoreWebView2Settings*, BOOL);
    HRESULT (STDMETHODCALLTYPE *get_IsZoomControlEnabled)(ICoreWebView2Settings*, BOOL*);
    HRESULT (STDMETHODCALLTYPE *put_IsZoomControlEnabled)(ICoreWebView2Settings*, BOOL);
    HRESULT (STDMETHODCALLTYPE *get_IsBuiltInErrorPageEnabled)(ICoreWebView2Settings*, BOOL*);
    HRESULT (STDMETHODCALLTYPE *put_IsBuiltInErrorPageEnabled)(ICoreWebView2Settings*, BOOL);
} ICoreWebView2SettingsVtbl;

struct ICoreWebView2Settings {
    ICoreWebView2SettingsVtbl *lpVtbl;
};

/* ---------- ICoreWebView2WebMessageReceivedEventArgs vtable ---------- */

typedef struct ICoreWebView2WebMessageReceivedEventArgsVtbl {
    /* IUnknown */
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2WebMessageReceivedEventArgs*, REFIID, void**);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2WebMessageReceivedEventArgs*);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2WebMessageReceivedEventArgs*);
    /* ICoreWebView2WebMessageReceivedEventArgs */
    HRESULT (STDMETHODCALLTYPE *get_Source)(ICoreWebView2WebMessageReceivedEventArgs*, LPWSTR*);
    HRESULT (STDMETHODCALLTYPE *get_WebMessageAsJson)(ICoreWebView2WebMessageReceivedEventArgs*, LPWSTR*);
    HRESULT (STDMETHODCALLTYPE *TryGetWebMessageAsString)(ICoreWebView2WebMessageReceivedEventArgs*, LPWSTR*);
} ICoreWebView2WebMessageReceivedEventArgsVtbl;

struct ICoreWebView2WebMessageReceivedEventArgs {
    ICoreWebView2WebMessageReceivedEventArgsVtbl *lpVtbl;
};

/* ---------- ICoreWebView2NavigationCompletedEventArgs vtable ---------- */

typedef struct ICoreWebView2NavigationCompletedEventArgsVtbl {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2NavigationCompletedEventArgs*, REFIID, void**);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2NavigationCompletedEventArgs*);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2NavigationCompletedEventArgs*);
    HRESULT (STDMETHODCALLTYPE *get_IsSuccess)(ICoreWebView2NavigationCompletedEventArgs*, BOOL*);
    HRESULT (STDMETHODCALLTYPE *get_WebErrorStatus)(ICoreWebView2NavigationCompletedEventArgs*, int*);
    HRESULT (STDMETHODCALLTYPE *get_NavigationId)(ICoreWebView2NavigationCompletedEventArgs*, UINT64*);
} ICoreWebView2NavigationCompletedEventArgsVtbl;

struct ICoreWebView2NavigationCompletedEventArgs {
    ICoreWebView2NavigationCompletedEventArgsVtbl *lpVtbl;
};

/* ---------- ICoreWebView2 vtable ---------- */

typedef struct ICoreWebView2Vtbl {
    /* IUnknown (0-2) */
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2*, REFIID, void**);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2*);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2*);
    /* ICoreWebView2 methods — slots 3+ */
    HRESULT (STDMETHODCALLTYPE *get_Settings)(ICoreWebView2*, ICoreWebView2Settings**);             /* 3 */
    HRESULT (STDMETHODCALLTYPE *get_Source)(ICoreWebView2*, LPWSTR*);                                /* 4 */
    HRESULT (STDMETHODCALLTYPE *Navigate)(ICoreWebView2*, LPCWSTR);                                  /* 5 */
    HRESULT (STDMETHODCALLTYPE *NavigateToString)(ICoreWebView2*, LPCWSTR);                          /* 6 */
    void *add_NavigationStarting;                                                                     /* 7 */
    void *remove_NavigationStarting;                                                                  /* 8 */
    void *add_ContentLoading;                                                                         /* 9 */
    void *remove_ContentLoading;                                                                      /* 10 */
    void *add_SourceChanged;                                                                          /* 11 */
    void *remove_SourceChanged;                                                                       /* 12 */
    void *add_HistoryChanged;                                                                         /* 13 */
    void *remove_HistoryChanged;                                                                      /* 14 */
    HRESULT (STDMETHODCALLTYPE *add_NavigationCompleted)(ICoreWebView2*, void*, EventRegistrationToken*); /* 15 */
    void *remove_NavigationCompleted;                                                                 /* 16 */
    void *add_FrameNavigationStarting;                                                                /* 17 */
    void *remove_FrameNavigationStarting;                                                             /* 18 */
    void *add_FrameNavigationCompleted;                                                               /* 19 */
    void *remove_FrameNavigationCompleted;                                                            /* 20 */
    void *add_ScriptDialogOpening;                                                                    /* 21 */
    void *remove_ScriptDialogOpening;                                                                 /* 22 */
    void *add_PermissionRequested;                                                                    /* 23 */
    void *remove_PermissionRequested;                                                                 /* 24 */
    void *add_ProcessFailed;                                                                          /* 25 */
    void *remove_ProcessFailed;                                                                       /* 26 */
    HRESULT (STDMETHODCALLTYPE *AddScriptToExecuteOnDocumentCreated)(ICoreWebView2*, LPCWSTR, void*); /* 27 */
    void *RemoveScriptToExecuteOnDocumentCreated;                                                     /* 28 */
    HRESULT (STDMETHODCALLTYPE *ExecuteScript)(ICoreWebView2*, LPCWSTR, void*);                       /* 29 */
    void *CapturePreview;                                                                             /* 30 */
    HRESULT (STDMETHODCALLTYPE *Reload)(ICoreWebView2*);                                              /* 31 */
    void *PostWebMessageAsJson;                                                                       /* 32 */
    HRESULT (STDMETHODCALLTYPE *PostWebMessageAsString)(ICoreWebView2*, LPCWSTR);                     /* 33 */
    HRESULT (STDMETHODCALLTYPE *add_WebMessageReceived)(ICoreWebView2*, void*, EventRegistrationToken*); /* 34 */
    void *remove_WebMessageReceived;                                                                  /* 35 */
    /* remaining methods omitted — not needed */
} ICoreWebView2Vtbl;

struct ICoreWebView2 {
    ICoreWebView2Vtbl *lpVtbl;
};

/* ---------- ICoreWebView2Controller vtable ---------- */

typedef struct ICoreWebView2ControllerVtbl {
    /* IUnknown (0-2) */
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2Controller*, REFIID, void**);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2Controller*);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2Controller*);
    /* ICoreWebView2Controller */
    void *get_IsVisible;                                                                  /* 3 */
    void *put_IsVisible;                                                                  /* 4 */
    HRESULT (STDMETHODCALLTYPE *get_Bounds)(ICoreWebView2Controller*, RECT*);             /* 5 */
    HRESULT (STDMETHODCALLTYPE *put_Bounds)(ICoreWebView2Controller*, RECT);              /* 6 */
    void *get_ZoomFactor;                                                                 /* 7 */
    void *put_ZoomFactor;                                                                 /* 8 */
    void *add_ZoomFactorChanged;                                                          /* 9 */
    void *remove_ZoomFactorChanged;                                                       /* 10 */
    void *SetBoundsAndZoomFactor;                                                         /* 11 */
    void *MoveFocus;                                                                      /* 12 */
    void *add_MoveFocusRequested;                                                         /* 13 */
    void *remove_MoveFocusRequested;                                                      /* 14 */
    void *add_GotFocus;                                                                   /* 15 */
    void *remove_GotFocus;                                                                /* 16 */
    void *add_LostFocus;                                                                  /* 17 */
    void *remove_LostFocus;                                                               /* 18 */
    void *add_AcceleratorKeyPressed;                                                      /* 19 */
    void *remove_AcceleratorKeyPressed;                                                   /* 20 */
    void *get_ParentWindow;                                                               /* 21 */
    void *put_ParentWindow;                                                               /* 22 */
    void *NotifyParentWindowPositionChanged;                                              /* 23 */
    void *Close;                                                                          /* 24 */
    HRESULT (STDMETHODCALLTYPE *get_CoreWebView2)(ICoreWebView2Controller*, ICoreWebView2**); /* 25 */
} ICoreWebView2ControllerVtbl;

struct ICoreWebView2Controller {
    ICoreWebView2ControllerVtbl *lpVtbl;
};

/* ---------- ICoreWebView2Environment vtable ---------- */

typedef struct ICoreWebView2EnvironmentVtbl {
    /* IUnknown (0-2) */
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2Environment*, REFIID, void**);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ICoreWebView2Environment*);
    ULONG   (STDMETHODCALLTYPE *Release)(ICoreWebView2Environment*);
    /* ICoreWebView2Environment */
    HRESULT (STDMETHODCALLTYPE *CreateCoreWebView2Controller)(ICoreWebView2Environment*, HWND, void*); /* 3 */
    void *CreateWebResourceResponse;                                                                    /* 4 */
    void *get_BrowserVersionString;                                                                     /* 5 */
    void *add_NewBrowserVersionAvailable;                                                               /* 6 */
    void *remove_NewBrowserVersionAvailable;                                                            /* 7 */
} ICoreWebView2EnvironmentVtbl;

struct ICoreWebView2Environment {
    ICoreWebView2EnvironmentVtbl *lpVtbl;
};

/* ---------- WebView2Loader import ---------- */

typedef HRESULT (STDMETHODCALLTYPE *PFN_CreateCoreWebView2EnvironmentWithOptions)(
    LPCWSTR browserExecutableFolder,
    LPCWSTR userDataFolder,
    void* environmentOptions,
    void* environmentCreatedHandler
);

/* We link against WebView2Loader.lib which exports this */
extern HRESULT __stdcall CreateCoreWebView2EnvironmentWithOptions(
    LPCWSTR browserExecutableFolder,
    LPCWSTR userDataFolder,
    void* environmentOptions,
    void* environmentCreatedHandler
);

/* ---------- globals ---------- */

static uint8_t  *g_shm     = NULL;
static HANDLE    g_hmap     = NULL;
static HANDLE    g_evt_tb   = NULL;
static HANDLE    g_evt_ts   = NULL;
static HWND      g_hwnd     = NULL;

static ICoreWebView2Environment *g_env        = NULL;
static ICoreWebView2Controller  *g_controller  = NULL;
static ICoreWebView2            *g_webview     = NULL;

static wchar_t   g_html_url[MAX_PATH + 16];
static char      g_title[256] = "Butter App";

/* tray icon state */
#define WM_TRAYICON (WM_USER + 1)
static NOTIFYICONDATAW g_nid;
static int             g_tray_active = 0;
static HMENU           g_tray_menu = NULL;

/* tray menu action storage */
#define MAX_TRAY_ITEMS 32
static char g_tray_actions[MAX_TRAY_ITEMS][128];
static int  g_tray_action_count = 0;

/* menu bar */
static HMENU g_app_menu = NULL;
#define MAX_MENU_ACTIONS 128
static char g_menu_actions[MAX_MENU_ACTIONS][128];
static int  g_menu_action_count = 0;

/* deep link scheme (set via BUTTER_SCHEME env) */
static char g_deeplink_scheme[128] = "";

/* multi-window tracking */
#define MAX_WINDOWS 16
typedef struct {
    char   id[64];
    HWND   hwnd;
    ICoreWebView2Controller *controller;
    ICoreWebView2           *webview;
} ChildWindow;
static ChildWindow g_children[MAX_WINDOWS];
static int         g_child_count = 0;

/* ---------- LE uint32 helpers ---------- */

static uint32_t read_u32(const uint8_t *p) {
    return (uint32_t)p[0]
         | ((uint32_t)p[1] << 8)
         | ((uint32_t)p[2] << 16)
         | ((uint32_t)p[3] << 24);
}

static void write_u32(uint8_t *p, uint32_t v) {
    p[0] = (uint8_t)v;
    p[1] = (uint8_t)(v >> 8);
    p[2] = (uint8_t)(v >> 16);
    p[3] = (uint8_t)(v >> 24);
}

/* ---------- ring buffer write (to-bun) ---------- */

static void ring_write_tb(const char *json, size_t len) {
    uint32_t total = MSG_HDR + (uint32_t)len;
    uint32_t wcur = read_u32(g_shm + TB_WCUR);

    uint8_t hdr[4];
    write_u32(hdr, (uint32_t)len);
    for (uint32_t i = 0; i < MSG_HDR; i++)
        g_shm[RING_TB_OFF + ((wcur + i) % RING_SIZE)] = hdr[i];
    for (uint32_t i = 0; i < (uint32_t)len; i++)
        g_shm[RING_TB_OFF + ((wcur + MSG_HDR + i) % RING_SIZE)] = (uint8_t)json[i];

    write_u32(g_shm + TB_WCUR, (wcur + total) % RING_SIZE);
    SetEvent(g_evt_tb);
}

/* ---------- ring buffer read (to-shim) ---------- */

static char *ring_read_ts(void) {
    uint32_t wcur = read_u32(g_shm + TS_WCUR);
    uint32_t rcur = read_u32(g_shm + TS_RCUR);
    if (wcur == rcur) return NULL;

    uint32_t avail = (wcur >= rcur) ? (wcur - rcur) : (RING_SIZE - rcur + wcur);
    if (avail < MSG_HDR) return NULL;

    uint8_t hdr[4];
    for (uint32_t i = 0; i < MSG_HDR; i++)
        hdr[i] = g_shm[RING_TS_OFF + ((rcur + i) % RING_SIZE)];

    uint32_t len = read_u32(hdr);
    if (avail < MSG_HDR + len) return NULL;

    char *buf = (char *)malloc(len + 1);
    for (uint32_t i = 0; i < len; i++)
        buf[i] = (char)g_shm[RING_TS_OFF + ((rcur + MSG_HDR + i) % RING_SIZE)];
    buf[len] = '\0';

    write_u32(g_shm + TS_RCUR, (rcur + MSG_HDR + len) % RING_SIZE);
    return buf;
}

/* ---------- bridge JS ---------- */

static const wchar_t *BRIDGE_JS =
    L"(function(){"
    L"var p=new Map(),n=1,l=new Map();"
    L"window.__butterReceive=function(j){"
      L"var m=JSON.parse(j);"
      L"if(m.type==='response'&&m.action==='chunk'&&m.data){"
        L"var e=p.get(m.data.id);if(e&&e.onChunk)e.onChunk(m.data.data);}"
      L"else if(m.type==='response'){"
        L"var e=p.get(m.id);if(e){p.delete(m.id);if(e.timer)clearTimeout(e.timer);"
        L"if(m.error)e.reject(new Error(m.error));else e.resolve(m.data);}}"
      L"else if(m.type==='event'){"
        L"var h=l.get(m.action)||[];for(var i=0;i<h.length;i++)h[i](m.data);}"
    L"};"
    L"var send=function(m){"
      L"window.chrome.webview.postMessage(JSON.stringify(m));"
    L"};"
    L"window.butter={"
      L"invoke:function(a,d,o){return new Promise(function(res,rej){"
        L"var id=String(n++),e={resolve:res,reject:rej,timer:null};"
        L"var t=o&&o.timeout;if(t&&t>0){e.timer=setTimeout(function(){"
          L"p.delete(id);rej(new Error('butter.invoke(\"'+a+'\") timed out after '+t+'ms'));},t);}"
        L"p.set(id,e);send({id:id,type:'invoke',action:a,data:d});});},"
      L"stream:function(a,d,cb){return new Promise(function(res,rej){"
        L"var id=String(n++),e={resolve:res,reject:rej,timer:null,onChunk:cb};"
        L"p.set(id,e);send({id:id,type:'invoke',action:a,data:d,stream:true});});},"
      L"on:function(a,h){if(!l.has(a))l.set(a,[]);l.get(a).push(h);},"
      L"off:function(a,h){var hs=l.get(a);if(!hs)return;var i=hs.indexOf(h);if(i!==-1)hs.splice(i,1);}"
    L"};"
    L"document.addEventListener('dragover',function(e){e.preventDefault();});"
    L"document.addEventListener('drop',function(e){"
      L"e.preventDefault();"
      L"var f=[];if(e.dataTransfer&&e.dataTransfer.files){"
        L"for(var i=0;i<e.dataTransfer.files.length;i++){"
          L"var x=e.dataTransfer.files[i];f.push({name:x.name,size:x.size,type:x.type,path:x.path||''});}}"
      L"if(f.length>0)send({id:String(n++),type:'event',action:'drop:files',data:f});"
    L"});"
    L"})();";

/* ---------- escape JSON for JS injection ---------- */

static wchar_t *escape_for_js(const char *json) {
    size_t len = strlen(json);
    /* worst case: every char needs escaping, plus wide char */
    wchar_t *out = (wchar_t *)malloc((len * 2 + 1) * sizeof(wchar_t));
    size_t j = 0;

    for (size_t i = 0; i < len; i++) {
        switch (json[i]) {
            case '\\': out[j++] = L'\\'; out[j++] = L'\\'; break;
            case '\'': out[j++] = L'\\'; out[j++] = L'\''; break;
            case '\n': out[j++] = L'\\'; out[j++] = L'n';  break;
            case '\r': out[j++] = L'\\'; out[j++] = L'r';  break;
            default:   out[j++] = (wchar_t)(unsigned char)json[i]; break;
        }
    }
    out[j] = L'\0';
    return out;
}

/* ---------- UTF-8 <-> UTF-16 helpers ---------- */

static wchar_t *utf8_to_wide(const char *utf8) {
    int wlen = MultiByteToWideChar(CP_UTF8, 0, utf8, -1, NULL, 0);
    if (wlen <= 0) return NULL;
    wchar_t *wide = (wchar_t *)malloc(wlen * sizeof(wchar_t));
    MultiByteToWideChar(CP_UTF8, 0, utf8, -1, wide, wlen);
    return wide;
}

static char *wide_to_utf8(const wchar_t *wide) {
    int ulen = WideCharToMultiByte(CP_UTF8, 0, wide, -1, NULL, 0, NULL, NULL);
    if (ulen <= 0) return NULL;
    char *utf8 = (char *)malloc(ulen);
    WideCharToMultiByte(CP_UTF8, 0, wide, -1, utf8, ulen, NULL, NULL);
    return utf8;
}

/* ============================================================
 * COM event handler implementations
 *
 * WebView2 requires callback objects implementing specific COM
 * interfaces. We implement them as plain C structs with vtables.
 * ============================================================ */

/* ---------- WebMessageReceivedEventHandler ---------- */

typedef struct WebMessageHandler {
    void *lpVtbl; /* pointer to vtable */
    LONG  refCount;
} WebMessageHandler;

static HRESULT STDMETHODCALLTYPE WMH_QueryInterface(WebMessageHandler *self, REFIID riid, void **ppv) {
    if (IsEqualGUID(riid, &IID_IUnknown) ||
        IsEqualGUID(riid, &IID_ICoreWebView2WebMessageReceivedEventHandler)) {
        *ppv = self;
        InterlockedIncrement(&self->refCount);
        return S_OK;
    }
    *ppv = NULL;
    return E_NOINTERFACE;
}

static ULONG STDMETHODCALLTYPE WMH_AddRef(WebMessageHandler *self) {
    return InterlockedIncrement(&self->refCount);
}

static ULONG STDMETHODCALLTYPE WMH_Release(WebMessageHandler *self) {
    LONG r = InterlockedDecrement(&self->refCount);
    if (r == 0) free(self);
    return r;
}

/* ---------- context menu handling ---------- */

static void handle_context_menu(const char *msg) {
    char msgId[64] = "0";
    json_extract_string(msg, "id", msgId, sizeof(msgId));

    HMENU hmenu = CreatePopupMenu();
    if (!hmenu) return;

    /* Simple parsing for label/action pairs */
    const char *pos = msg;
    int cmdId = 1;
    char actions[32][128];
    int actionCount = 0;

    while ((pos = strstr(pos, "\"label\":\"")) != NULL && actionCount < 32) {
        char label[128], action[128];
        pos += 9;
        const char *end = strchr(pos, '"');
        if (!end) break;
        size_t len = (size_t)(end - pos);
        if (len >= sizeof(label)) len = sizeof(label) - 1;
        memcpy(label, pos, len);
        label[len] = '\0';
        pos = end + 1;

        if (json_extract_string(pos, "action", action, sizeof(action))) {
            wchar_t *wlabel = utf8_to_wide(label);
            if (wlabel) {
                AppendMenuW(hmenu, MF_STRING, cmdId, wlabel);
                strncpy(actions[actionCount], action, sizeof(actions[actionCount]) - 1);
                actions[actionCount][sizeof(actions[actionCount]) - 1] = '\0';
                actionCount++;
                cmdId++;
                free(wlabel);
            }
        }
    }

    POINT pt;
    GetCursorPos(&pt);
    int selected = TrackPopupMenuEx(hmenu, TPM_RETURNCMD | TPM_NONOTIFY, pt.x, pt.y, g_hwnd, NULL);
    DestroyMenu(hmenu);

    if (selected > 0 && selected <= actionCount) {
        char resp[512];
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"__contextmenu\",\"data\":\"%s\"}",
            msgId, actions[selected - 1]);
        ring_write_tb(resp, strlen(resp));
    }
}

static HRESULT STDMETHODCALLTYPE WMH_Invoke(
    WebMessageHandler *self,
    ICoreWebView2 *sender,
    ICoreWebView2WebMessageReceivedEventArgs *args)
{
    (void)self;
    (void)sender;

    LPWSTR messageW = NULL;
    HRESULT hr = args->lpVtbl->TryGetWebMessageAsString(args, &messageW);
    if (SUCCEEDED(hr) && messageW) {
        char *utf8 = wide_to_utf8(messageW);
        if (utf8) {
            /* Intercept context menu requests */
            if (strstr(utf8, "\"__contextmenu\"")) {
                handle_context_menu(utf8);
                free(utf8);
                CoTaskMemFree(messageW);
                return S_OK;
            }
            /* Intercept dialog requests from webview — handle natively */
            if (strstr(utf8, "\"dialog:open\"") || strstr(utf8, "\"dialog:save\"") || strstr(utf8, "\"dialog:folder\"")) {
                handle_webview_dialog(utf8);
                free(utf8);
                CoTaskMemFree(messageW);
                return S_OK;
            }
            if (strstr(utf8, "\"dialog:message\"")) {
                handle_dialog_message(utf8, 1);
                free(utf8);
                CoTaskMemFree(messageW);
                return S_OK;
            }
            ring_write_tb(utf8, strlen(utf8));
            free(utf8);
        }
        CoTaskMemFree(messageW);
    }
    return S_OK;
}

/* vtable for WebMessageReceivedEventHandler */
static struct {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(WebMessageHandler*, REFIID, void**);
    ULONG   (STDMETHODCALLTYPE *AddRef)(WebMessageHandler*);
    ULONG   (STDMETHODCALLTYPE *Release)(WebMessageHandler*);
    HRESULT (STDMETHODCALLTYPE *Invoke)(WebMessageHandler*, ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs*);
} g_wmh_vtbl = {
    WMH_QueryInterface,
    WMH_AddRef,
    WMH_Release,
    WMH_Invoke
};

static WebMessageHandler *create_web_message_handler(void) {
    WebMessageHandler *h = (WebMessageHandler *)malloc(sizeof(WebMessageHandler));
    h->lpVtbl = &g_wmh_vtbl;
    h->refCount = 1;
    return h;
}

/* ---------- AddScriptToExecuteOnDocumentCreated handler (no-op callback) ---------- */

struct ScriptCompletedHandler {
    void *lpVtbl;
    LONG  refCount;
};

static HRESULT STDMETHODCALLTYPE SCH_QueryInterface(ScriptCompletedHandler *self, REFIID riid, void **ppv) {
    (void)riid;
    *ppv = self;
    InterlockedIncrement(&self->refCount);
    return S_OK;
}

static ULONG STDMETHODCALLTYPE SCH_AddRef(ScriptCompletedHandler *self) {
    return InterlockedIncrement(&self->refCount);
}

static ULONG STDMETHODCALLTYPE SCH_Release(ScriptCompletedHandler *self) {
    LONG r = InterlockedDecrement(&self->refCount);
    if (r == 0) free(self);
    return r;
}

static HRESULT STDMETHODCALLTYPE SCH_Invoke(ScriptCompletedHandler *self, HRESULT errorCode, LPCWSTR id) {
    (void)self; (void)errorCode; (void)id;
    return S_OK;
}

static struct {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ScriptCompletedHandler*, REFIID, void**);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ScriptCompletedHandler*);
    ULONG   (STDMETHODCALLTYPE *Release)(ScriptCompletedHandler*);
    HRESULT (STDMETHODCALLTYPE *Invoke)(ScriptCompletedHandler*, HRESULT, LPCWSTR);
} g_sch_vtbl = {
    SCH_QueryInterface,
    SCH_AddRef,
    SCH_Release,
    SCH_Invoke
};

static ScriptCompletedHandler *create_script_completed_handler(void) {
    ScriptCompletedHandler *h = (ScriptCompletedHandler *)malloc(sizeof(ScriptCompletedHandler));
    h->lpVtbl = &g_sch_vtbl;
    h->refCount = 1;
    return h;
}

/* ---------- ExecuteScript completed handler (no-op) ---------- */

/* Reuses same shape as ScriptCompletedHandler — same vtable works */

static ScriptCompletedHandler *create_execute_script_handler(void) {
    return create_script_completed_handler();
}

/* ---------- setup_webview: called once we have the ICoreWebView2 ---------- */

static void setup_webview(void) {
    if (!g_webview) return;

    /* enable web messages */
    ICoreWebView2Settings *settings = NULL;
    g_webview->lpVtbl->get_Settings(g_webview, &settings);
    if (settings) {
        settings->lpVtbl->put_IsWebMessageEnabled(settings, TRUE);
        settings->lpVtbl->put_IsScriptEnabled(settings, TRUE);

        /* dev tools */
        const char *devMode = getenv("BUTTER_DEV");
        if (devMode && strcmp(devMode, "1") == 0) {
            settings->lpVtbl->put_AreDevToolsEnabled(settings, TRUE);
        } else {
            settings->lpVtbl->put_AreDevToolsEnabled(settings, FALSE);
        }
        settings->lpVtbl->Release(settings);
    }

    /* inject bridge JS */
    ScriptCompletedHandler *sch = create_script_completed_handler();
    g_webview->lpVtbl->AddScriptToExecuteOnDocumentCreated(g_webview, BRIDGE_JS, (void *)sch);

    /* register web message handler */
    WebMessageHandler *wmh = create_web_message_handler();
    EventRegistrationToken token;
    g_webview->lpVtbl->add_WebMessageReceived(g_webview, (void *)wmh, &token);

    /* navigate to HTML file */
    g_webview->lpVtbl->Navigate(g_webview, g_html_url);

    /* start poll timer */
    SetTimer(g_hwnd, POLL_TIMER_ID, POLL_INTERVAL, NULL);
}

/* ---------- CreateCoreWebView2Controller completed handler ---------- */

struct ControllerCreatedHandler {
    void *lpVtbl;
    LONG  refCount;
};

static HRESULT STDMETHODCALLTYPE CCH_QueryInterface(ControllerCreatedHandler *self, REFIID riid, void **ppv) {
    if (IsEqualGUID(riid, &IID_IUnknown) ||
        IsEqualGUID(riid, &IID_ICoreWebView2CreateCoreWebView2ControllerCompletedHandler)) {
        *ppv = self;
        InterlockedIncrement(&self->refCount);
        return S_OK;
    }
    *ppv = NULL;
    return E_NOINTERFACE;
}

static ULONG STDMETHODCALLTYPE CCH_AddRef(ControllerCreatedHandler *self) {
    return InterlockedIncrement(&self->refCount);
}

static ULONG STDMETHODCALLTYPE CCH_Release(ControllerCreatedHandler *self) {
    LONG r = InterlockedDecrement(&self->refCount);
    if (r == 0) free(self);
    return r;
}

static HRESULT STDMETHODCALLTYPE CCH_Invoke(
    ControllerCreatedHandler *self,
    HRESULT result,
    ICoreWebView2Controller *controller)
{
    (void)self;

    if (FAILED(result) || !controller) {
        fprintf(stderr, "[shim] WebView2 controller creation failed: 0x%08lx\n", result);
        PostQuitMessage(1);
        return S_OK;
    }

    g_controller = controller;
    controller->lpVtbl->AddRef(controller);

    /* size to window client area */
    RECT bounds;
    GetClientRect(g_hwnd, &bounds);
    controller->lpVtbl->put_Bounds(controller, bounds);

    /* get ICoreWebView2 */
    controller->lpVtbl->get_CoreWebView2(controller, &g_webview);
    if (!g_webview) {
        fprintf(stderr, "[shim] failed to get ICoreWebView2\n");
        PostQuitMessage(1);
        return S_OK;
    }

    setup_webview();
    return S_OK;
}

static struct {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ControllerCreatedHandler*, REFIID, void**);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ControllerCreatedHandler*);
    ULONG   (STDMETHODCALLTYPE *Release)(ControllerCreatedHandler*);
    HRESULT (STDMETHODCALLTYPE *Invoke)(ControllerCreatedHandler*, HRESULT, ICoreWebView2Controller*);
} g_cch_vtbl = {
    CCH_QueryInterface,
    CCH_AddRef,
    CCH_Release,
    CCH_Invoke
};

static ControllerCreatedHandler *create_controller_handler(void) {
    ControllerCreatedHandler *h = (ControllerCreatedHandler *)malloc(sizeof(ControllerCreatedHandler));
    h->lpVtbl = &g_cch_vtbl;
    h->refCount = 1;
    return h;
}

/* ---------- CreateCoreWebView2Environment completed handler ---------- */

typedef struct EnvCreatedHandler {
    void *lpVtbl;
    LONG  refCount;
} EnvCreatedHandler;

static HRESULT STDMETHODCALLTYPE ECH_QueryInterface(EnvCreatedHandler *self, REFIID riid, void **ppv) {
    if (IsEqualGUID(riid, &IID_IUnknown) ||
        IsEqualGUID(riid, &IID_ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler)) {
        *ppv = self;
        InterlockedIncrement(&self->refCount);
        return S_OK;
    }
    *ppv = NULL;
    return E_NOINTERFACE;
}

static ULONG STDMETHODCALLTYPE ECH_AddRef(EnvCreatedHandler *self) {
    return InterlockedIncrement(&self->refCount);
}

static ULONG STDMETHODCALLTYPE ECH_Release(EnvCreatedHandler *self) {
    LONG r = InterlockedDecrement(&self->refCount);
    if (r == 0) free(self);
    return r;
}

static HRESULT STDMETHODCALLTYPE ECH_Invoke(
    EnvCreatedHandler *self,
    HRESULT result,
    ICoreWebView2Environment *env)
{
    (void)self;

    if (FAILED(result) || !env) {
        fprintf(stderr, "[shim] WebView2 environment creation failed: 0x%08lx\n", result);
        PostQuitMessage(1);
        return S_OK;
    }

    g_env = env;
    env->lpVtbl->AddRef(env);

    ControllerCreatedHandler *cch = create_controller_handler();
    env->lpVtbl->CreateCoreWebView2Controller(env, g_hwnd, (void *)cch);

    return S_OK;
}

static struct {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(EnvCreatedHandler*, REFIID, void**);
    ULONG   (STDMETHODCALLTYPE *AddRef)(EnvCreatedHandler*);
    ULONG   (STDMETHODCALLTYPE *Release)(EnvCreatedHandler*);
    HRESULT (STDMETHODCALLTYPE *Invoke)(EnvCreatedHandler*, HRESULT, ICoreWebView2Environment*);
} g_ech_vtbl = {
    ECH_QueryInterface,
    ECH_AddRef,
    ECH_Release,
    ECH_Invoke
};

static EnvCreatedHandler *create_env_handler(void) {
    EnvCreatedHandler *h = (EnvCreatedHandler *)malloc(sizeof(EnvCreatedHandler));
    h->lpVtbl = &g_ech_vtbl;
    h->refCount = 1;
    return h;
}

/* ---------- minimal JSON helpers ---------- */

static int json_extract_string(const char *json, const char *key, char *out, size_t outlen) {
    char needle[128];
    snprintf(needle, sizeof(needle), "\"%s\":\"", key);
    const char *start = strstr(json, needle);
    if (!start) return 0;
    start += strlen(needle);
    const char *end = strchr(start, '"');
    if (!end) return 0;
    size_t len = (size_t)(end - start);
    if (len >= outlen) len = outlen - 1;
    memcpy(out, start, len);
    out[len] = '\0';
    return 1;
}

static double json_extract_number(const char *json, const char *key, double fallback) {
    char needle[128];
    snprintf(needle, sizeof(needle), "\"%s\":", key);
    const char *start = strstr(json, needle);
    if (!start) return fallback;
    start += strlen(needle);
    while (*start == ' ') start++;
    if (*start == '"') return fallback;
    return atof(start);
}

/* ---------- JSON array extraction helper ---------- */

/* Extract a JSON array of strings like ["ext1","ext2"] starting at *pos.
 * Returns count of extracted strings. out[i] must be char[128]. */
static int json_extract_string_array(const char *json, const char *key, char out[][128], int maxout) {
    char needle[128];
    snprintf(needle, sizeof(needle), "\"%s\":[", key);
    const char *start = strstr(json, needle);
    if (!start) return 0;
    start += strlen(needle);
    int count = 0;
    while (count < maxout) {
        const char *q1 = strchr(start, '"');
        if (!q1 || *start == ']') break;
        q1++;
        const char *q2 = strchr(q1, '"');
        if (!q2) break;
        size_t len = (size_t)(q2 - q1);
        if (len >= 128) len = 127;
        memcpy(out[count], q1, len);
        out[count][len] = '\0';
        count++;
        start = q2 + 1;
        while (*start == ' ' || *start == ',') start++;
    }
    return count;
}

/* ---------- JSON boolean extraction ---------- */

static int json_extract_bool(const char *json, const char *key, int fallback) {
    char needle[128];
    snprintf(needle, sizeof(needle), "\"%s\":", key);
    const char *start = strstr(json, needle);
    if (!start) return fallback;
    start += strlen(needle);
    while (*start == ' ') start++;
    if (strncmp(start, "true", 4) == 0) return 1;
    if (strncmp(start, "false", 5) == 0) return 0;
    return fallback;
}

/* ---------- dialog:open handler ---------- */

static void handle_dialog_open(const char *msg) {
    char msgId[64] = "0";
    json_extract_string(msg, "id", msgId, sizeof(msgId));
    char title[256] = "";
    json_extract_string(msg, "title", title, sizeof(title));
    int multiple = json_extract_bool(msg, "multiple", 0);

    /* Build filter string from "filters" */
    char filterExts[8][128];
    int extCount = json_extract_string_array(msg, "extensions", filterExts, 8);

    IFileOpenDialog *pDialog = NULL;
    HRESULT hr = CoCreateInstance(
        &CLSID_FileOpenDialog, NULL, CLSCTX_INPROC_SERVER,
        &IID_IFileOpenDialog, (void **)&pDialog);
    if (FAILED(hr) || !pDialog) {
        char resp[512];
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"dialog:open\",\"data\":{\"paths\":[],\"cancelled\":true}}",
            msgId);
        ring_write_tb(resp, strlen(resp));
        return;
    }

    if (title[0]) {
        wchar_t *wtitle = utf8_to_wide(title);
        if (wtitle) { pDialog->lpVtbl->SetTitle(pDialog, wtitle); free(wtitle); }
    }

    DWORD opts = 0;
    pDialog->lpVtbl->GetOptions(pDialog, &opts);
    opts |= FOS_FORCEFILESYSTEM;
    if (multiple) opts |= FOS_ALLOWMULTISELECT;
    pDialog->lpVtbl->SetOptions(pDialog, opts);

    /* Set file type filter if extensions provided */
    if (extCount > 0) {
        /* Build a single combined filter spec */
        wchar_t filterStr[512] = L"";
        for (int i = 0; i < extCount; i++) {
            wchar_t buf[64];
            wchar_t *wext = utf8_to_wide(filterExts[i]);
            if (wext) {
                _snwprintf(buf, 64, L"*.%s", wext);
                free(wext);
                if (i > 0) wcscat(filterStr, L";");
                wcscat(filterStr, buf);
            }
        }
        COMDLG_FILTERSPEC spec;
        spec.pszName = L"Files";
        spec.pszSpec = filterStr;
        pDialog->lpVtbl->SetFileTypes(pDialog, 1, &spec);
    }

    hr = pDialog->lpVtbl->Show(pDialog, g_hwnd);
    if (FAILED(hr)) {
        char resp[512];
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"dialog:open\",\"data\":{\"paths\":[],\"cancelled\":true}}",
            msgId);
        ring_write_tb(resp, strlen(resp));
        pDialog->lpVtbl->Release(pDialog);
        return;
    }

    /* Collect results */
    char pathsBuf[4096] = "[";
    int pathCount = 0;

    if (multiple) {
        IShellItemArray *pResults = NULL;
        pDialog->lpVtbl->GetResults(pDialog, &pResults);
        if (pResults) {
            DWORD count = 0;
            pResults->lpVtbl->GetCount(pResults, &count);
            for (DWORD i = 0; i < count; i++) {
                IShellItem *pItem = NULL;
                pResults->lpVtbl->GetItemAt(pResults, i, &pItem);
                if (pItem) {
                    PWSTR pszPath = NULL;
                    pItem->lpVtbl->GetDisplayName(pItem, SIGDN_FILESYSPATH, &pszPath);
                    if (pszPath) {
                        char *utf8path = wide_to_utf8(pszPath);
                        if (utf8path) {
                            if (pathCount > 0) strcat(pathsBuf, ",");
                            strcat(pathsBuf, "\"");
                            /* Escape backslashes */
                            char escaped[MAX_PATH * 2];
                            int ei = 0;
                            for (int j = 0; utf8path[j] && ei < (int)sizeof(escaped) - 2; j++) {
                                if (utf8path[j] == '\\') { escaped[ei++] = '\\'; escaped[ei++] = '\\'; }
                                else escaped[ei++] = utf8path[j];
                            }
                            escaped[ei] = '\0';
                            strcat(pathsBuf, escaped);
                            strcat(pathsBuf, "\"");
                            pathCount++;
                            free(utf8path);
                        }
                        CoTaskMemFree(pszPath);
                    }
                    pItem->lpVtbl->Release(pItem);
                }
            }
            pResults->lpVtbl->Release(pResults);
        }
    } else {
        IShellItem *pItem = NULL;
        pDialog->lpVtbl->GetResult(pDialog, &pItem);
        if (pItem) {
            PWSTR pszPath = NULL;
            pItem->lpVtbl->GetDisplayName(pItem, SIGDN_FILESYSPATH, &pszPath);
            if (pszPath) {
                char *utf8path = wide_to_utf8(pszPath);
                if (utf8path) {
                    strcat(pathsBuf, "\"");
                    char escaped[MAX_PATH * 2];
                    int ei = 0;
                    for (int j = 0; utf8path[j] && ei < (int)sizeof(escaped) - 2; j++) {
                        if (utf8path[j] == '\\') { escaped[ei++] = '\\'; escaped[ei++] = '\\'; }
                        else escaped[ei++] = utf8path[j];
                    }
                    escaped[ei] = '\0';
                    strcat(pathsBuf, escaped);
                    strcat(pathsBuf, "\"");
                    pathCount++;
                    free(utf8path);
                }
                CoTaskMemFree(pszPath);
            }
            pItem->lpVtbl->Release(pItem);
        }
    }
    strcat(pathsBuf, "]");

    char resp[4096 + 256];
    snprintf(resp, sizeof(resp),
        "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"dialog:open\",\"data\":{\"paths\":%s,\"cancelled\":false}}",
        msgId, pathsBuf);
    ring_write_tb(resp, strlen(resp));
    pDialog->lpVtbl->Release(pDialog);
}

/* ---------- dialog:save handler ---------- */

static void handle_dialog_save(const char *msg) {
    char msgId[64] = "0";
    json_extract_string(msg, "id", msgId, sizeof(msgId));
    char title[256] = "";
    json_extract_string(msg, "title", title, sizeof(title));
    char defaultName[256] = "";
    json_extract_string(msg, "defaultName", defaultName, sizeof(defaultName));

    IFileSaveDialog *pDialog = NULL;
    HRESULT hr = CoCreateInstance(
        &CLSID_FileSaveDialog, NULL, CLSCTX_INPROC_SERVER,
        &IID_IFileSaveDialog, (void **)&pDialog);
    if (FAILED(hr) || !pDialog) {
        char resp[512];
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"dialog:save\",\"data\":{\"path\":\"\",\"cancelled\":true}}",
            msgId);
        ring_write_tb(resp, strlen(resp));
        return;
    }

    if (title[0]) {
        wchar_t *wtitle = utf8_to_wide(title);
        if (wtitle) { pDialog->lpVtbl->SetTitle(pDialog, wtitle); free(wtitle); }
    }

    if (defaultName[0]) {
        wchar_t *wname = utf8_to_wide(defaultName);
        if (wname) { pDialog->lpVtbl->SetFileName(pDialog, wname); free(wname); }
    }

    DWORD opts = 0;
    pDialog->lpVtbl->GetOptions(pDialog, &opts);
    opts |= FOS_FORCEFILESYSTEM | FOS_OVERWRITEPROMPT;
    pDialog->lpVtbl->SetOptions(pDialog, opts);

    char filterExts[8][128];
    int extCount = json_extract_string_array(msg, "extensions", filterExts, 8);
    if (extCount > 0) {
        wchar_t filterStr[512] = L"";
        for (int i = 0; i < extCount; i++) {
            wchar_t buf[64];
            wchar_t *wext = utf8_to_wide(filterExts[i]);
            if (wext) {
                _snwprintf(buf, 64, L"*.%s", wext);
                free(wext);
                if (i > 0) wcscat(filterStr, L";");
                wcscat(filterStr, buf);
            }
        }
        COMDLG_FILTERSPEC spec;
        spec.pszName = L"Files";
        spec.pszSpec = filterStr;
        pDialog->lpVtbl->SetFileTypes(pDialog, 1, &spec);
    }

    hr = pDialog->lpVtbl->Show(pDialog, g_hwnd);
    if (FAILED(hr)) {
        char resp[512];
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"dialog:save\",\"data\":{\"path\":\"\",\"cancelled\":true}}",
            msgId);
        ring_write_tb(resp, strlen(resp));
        pDialog->lpVtbl->Release(pDialog);
        return;
    }

    IShellItem *pItem = NULL;
    pDialog->lpVtbl->GetResult(pDialog, &pItem);
    char pathEscaped[MAX_PATH * 2] = "";
    if (pItem) {
        PWSTR pszPath = NULL;
        pItem->lpVtbl->GetDisplayName(pItem, SIGDN_FILESYSPATH, &pszPath);
        if (pszPath) {
            char *utf8path = wide_to_utf8(pszPath);
            if (utf8path) {
                int ei = 0;
                for (int j = 0; utf8path[j] && ei < (int)sizeof(pathEscaped) - 2; j++) {
                    if (utf8path[j] == '\\') { pathEscaped[ei++] = '\\'; pathEscaped[ei++] = '\\'; }
                    else pathEscaped[ei++] = utf8path[j];
                }
                pathEscaped[ei] = '\0';
                free(utf8path);
            }
            CoTaskMemFree(pszPath);
        }
        pItem->lpVtbl->Release(pItem);
    }

    char resp[MAX_PATH * 2 + 256];
    snprintf(resp, sizeof(resp),
        "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"dialog:save\",\"data\":{\"path\":\"%s\",\"cancelled\":false}}",
        msgId, pathEscaped);
    ring_write_tb(resp, strlen(resp));
    pDialog->lpVtbl->Release(pDialog);
}

/* ---------- dialog:folder handler ---------- */

static void handle_dialog_folder(const char *msg) {
    char msgId[64] = "0";
    json_extract_string(msg, "id", msgId, sizeof(msgId));
    char title[256] = "";
    json_extract_string(msg, "title", title, sizeof(title));

    IFileOpenDialog *pDialog = NULL;
    HRESULT hr = CoCreateInstance(
        &CLSID_FileOpenDialog, NULL, CLSCTX_INPROC_SERVER,
        &IID_IFileOpenDialog, (void **)&pDialog);
    if (FAILED(hr) || !pDialog) {
        char resp[512];
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"dialog:folder\",\"data\":{\"paths\":[],\"cancelled\":true}}",
            msgId);
        ring_write_tb(resp, strlen(resp));
        return;
    }

    if (title[0]) {
        wchar_t *wtitle = utf8_to_wide(title);
        if (wtitle) { pDialog->lpVtbl->SetTitle(pDialog, wtitle); free(wtitle); }
    }

    DWORD opts = 0;
    pDialog->lpVtbl->GetOptions(pDialog, &opts);
    opts |= FOS_FORCEFILESYSTEM | FOS_PICKFOLDERS;
    pDialog->lpVtbl->SetOptions(pDialog, opts);

    hr = pDialog->lpVtbl->Show(pDialog, g_hwnd);
    if (FAILED(hr)) {
        char resp[512];
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"dialog:folder\",\"data\":{\"paths\":[],\"cancelled\":true}}",
            msgId);
        ring_write_tb(resp, strlen(resp));
        pDialog->lpVtbl->Release(pDialog);
        return;
    }

    IShellItem *pItem = NULL;
    pDialog->lpVtbl->GetResult(pDialog, &pItem);
    char pathsBuf[4096] = "[";
    if (pItem) {
        PWSTR pszPath = NULL;
        pItem->lpVtbl->GetDisplayName(pItem, SIGDN_FILESYSPATH, &pszPath);
        if (pszPath) {
            char *utf8path = wide_to_utf8(pszPath);
            if (utf8path) {
                strcat(pathsBuf, "\"");
                char escaped[MAX_PATH * 2];
                int ei = 0;
                for (int j = 0; utf8path[j] && ei < (int)sizeof(escaped) - 2; j++) {
                    if (utf8path[j] == '\\') { escaped[ei++] = '\\'; escaped[ei++] = '\\'; }
                    else escaped[ei++] = utf8path[j];
                }
                escaped[ei] = '\0';
                strcat(pathsBuf, escaped);
                strcat(pathsBuf, "\"");
                free(utf8path);
            }
            CoTaskMemFree(pszPath);
        }
        pItem->lpVtbl->Release(pItem);
    }
    strcat(pathsBuf, "]");

    char resp[4096 + 256];
    snprintf(resp, sizeof(resp),
        "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"dialog:folder\",\"data\":{\"paths\":%s,\"cancelled\":false}}",
        msgId, pathsBuf);
    ring_write_tb(resp, strlen(resp));
    pDialog->lpVtbl->Release(pDialog);
}

/* ---------- dialog:message handler ---------- */

static void handle_dialog_message(const char *msg, int from_webview) {
    char msgId[64] = "0";
    json_extract_string(msg, "id", msgId, sizeof(msgId));
    char title[256] = "";
    json_extract_string(msg, "title", title, sizeof(title));
    char message[1024] = "";
    json_extract_string(msg, "message", message, sizeof(message));
    char detail[1024] = "";
    json_extract_string(msg, "detail", detail, sizeof(detail));
    char type[32] = "info";
    json_extract_string(msg, "type", type, sizeof(type));

    /* Build full message text (message + detail) */
    char fullMsg[2048];
    if (detail[0]) {
        snprintf(fullMsg, sizeof(fullMsg), "%s\n\n%s", message, detail);
    } else {
        snprintf(fullMsg, sizeof(fullMsg), "%s", message);
    }

    UINT mbType = MB_OK;
    if (strcmp(type, "warning") == 0) {
        mbType |= MB_ICONWARNING;
    } else if (strcmp(type, "error") == 0) {
        mbType |= MB_ICONERROR;
    } else {
        mbType |= MB_ICONINFORMATION;
    }

    /* Check for custom buttons — if present, use yes/no/cancel style */
    char buttons[4][128];
    int btnCount = json_extract_string_array(msg, "buttons", buttons, 4);
    if (btnCount >= 3) {
        mbType = (mbType & 0xFFFFFFF0) | MB_YESNOCANCEL;
    } else if (btnCount == 2) {
        mbType = (mbType & 0xFFFFFFF0) | MB_YESNO;
    }

    wchar_t *wtitle = utf8_to_wide(title[0] ? title : "Butter");
    wchar_t *wmsg = utf8_to_wide(fullMsg);

    int result = MessageBoxW(g_hwnd, wmsg ? wmsg : L"", wtitle ? wtitle : L"", mbType);
    free(wtitle);
    free(wmsg);

    int buttonIndex = 0;
    switch (result) {
        case IDYES:    buttonIndex = 0; break;
        case IDNO:     buttonIndex = 1; break;
        case IDCANCEL: buttonIndex = 2; break;
        case IDOK:     buttonIndex = 0; break;
    }

    char resp[512];
    snprintf(resp, sizeof(resp),
        "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"dialog:message\",\"data\":{\"button\":%d,\"cancelled\":false}}",
        msgId, buttonIndex);

    if (from_webview) {
        /* Inject back into webview */
        if (g_webview) {
            wchar_t *escaped = escape_for_js(resp);
            size_t prefix_len = wcslen(L"window.__butterReceive('");
            size_t suffix_len = wcslen(L"')");
            size_t esc_len = wcslen(escaped);
            size_t jslen = prefix_len + esc_len + suffix_len + 1;
            wchar_t *js = (wchar_t *)malloc(jslen * sizeof(wchar_t));
            _snwprintf(js, jslen, L"window.__butterReceive('%s')", escaped);
            js[jslen - 1] = L'\0';
            ScriptCompletedHandler *esh = create_execute_script_handler();
            g_webview->lpVtbl->ExecuteScript(g_webview, js, (void *)esh);
            free(js);
            free(escaped);
        }
    } else {
        ring_write_tb(resp, strlen(resp));
    }
}

/* ---------- tray:set handler ---------- */

static void handle_tray_set(const char *msg) {
    char title[128] = "";
    json_extract_string(msg, "title", title, sizeof(title));
    char tooltip[256] = "";
    json_extract_string(msg, "tooltip", tooltip, sizeof(tooltip));

    if (!g_tray_active) {
        memset(&g_nid, 0, sizeof(g_nid));
        g_nid.cbSize = sizeof(NOTIFYICONDATAW);
        g_nid.hWnd = g_hwnd;
        g_nid.uID = 1;
        g_nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
        g_nid.uCallbackMessage = WM_TRAYICON;
        g_nid.hIcon = LoadIconW(NULL, IDI_APPLICATION);
        Shell_NotifyIconW(NIM_ADD, &g_nid);
        g_tray_active = 1;
    }

    if (tooltip[0]) {
        wchar_t *wtooltip = utf8_to_wide(tooltip);
        if (wtooltip) {
            wcsncpy(g_nid.szTip, wtooltip, 127);
            g_nid.szTip[127] = L'\0';
            free(wtooltip);
        }
        g_nid.uFlags |= NIF_TIP;
        Shell_NotifyIconW(NIM_MODIFY, &g_nid);
    }

    /* Build tray context menu from items array */
    if (g_tray_menu) { DestroyMenu(g_tray_menu); g_tray_menu = NULL; }
    g_tray_action_count = 0;

    /* Parse items from the JSON */
    const char *pos = msg;
    int cmdId = 1;
    while ((pos = strstr(pos, "\"label\":\"")) != NULL && g_tray_action_count < MAX_TRAY_ITEMS) {
        char label[128], action[128];
        pos += 9;
        const char *end = strchr(pos, '"');
        if (!end) break;
        size_t len = (size_t)(end - pos);
        if (len >= sizeof(label)) len = sizeof(label) - 1;
        memcpy(label, pos, len);
        label[len] = '\0';
        pos = end + 1;

        if (json_extract_string(pos, "action", action, sizeof(action))) {
            if (!g_tray_menu) g_tray_menu = CreatePopupMenu();
            wchar_t *wlabel = utf8_to_wide(label);
            if (wlabel) {
                AppendMenuW(g_tray_menu, MF_STRING, cmdId, wlabel);
                strncpy(g_tray_actions[g_tray_action_count], action, sizeof(g_tray_actions[0]) - 1);
                g_tray_actions[g_tray_action_count][sizeof(g_tray_actions[0]) - 1] = '\0';
                g_tray_action_count++;
                cmdId++;
                free(wlabel);
            }
        }
    }
}

/* ---------- tray:remove handler ---------- */

static void handle_tray_remove(void) {
    if (g_tray_active) {
        Shell_NotifyIconW(NIM_DELETE, &g_nid);
        g_tray_active = 0;
    }
    if (g_tray_menu) {
        DestroyMenu(g_tray_menu);
        g_tray_menu = NULL;
    }
    g_tray_action_count = 0;
}

/* ---------- screen:list handler ---------- */

typedef struct {
    char buf[8192];
    int count;
} ScreenEnumData;

static BOOL CALLBACK monitor_enum_proc(HMONITOR hMonitor, HDC hdcMonitor, LPRECT lprcMonitor, LPARAM dwData) {
    (void)hdcMonitor;
    (void)lprcMonitor;
    ScreenEnumData *sed = (ScreenEnumData *)dwData;

    MONITORINFOEXW mi;
    mi.cbSize = sizeof(MONITORINFOEXW);
    if (!GetMonitorInfoW(hMonitor, (MONITORINFO *)&mi)) return TRUE;

    /* Try to get DPI */
    UINT dpiX = 96, dpiY = 96;
    /* GetDpiForMonitor is in shcore.dll */
    typedef HRESULT (WINAPI *PFN_GetDpiForMonitor)(HMONITOR, int, UINT*, UINT*);
    static PFN_GetDpiForMonitor pGetDpiForMonitor = NULL;
    static int dpiLoaded = 0;
    if (!dpiLoaded) {
        HMODULE hShcore = LoadLibraryW(L"shcore.dll");
        if (hShcore) {
            pGetDpiForMonitor = (PFN_GetDpiForMonitor)GetProcAddress(hShcore, "GetDpiForMonitor");
        }
        dpiLoaded = 1;
    }
    if (pGetDpiForMonitor) {
        pGetDpiForMonitor(hMonitor, 0 /* MDT_EFFECTIVE_DPI */, &dpiX, &dpiY);
    }

    double scaleFactor = (double)dpiX / 96.0;
    int isPrimary = (mi.rcMonitor.left == 0 && mi.rcMonitor.top == 0) ? 1 : 0;

    char entry[512];
    snprintf(entry, sizeof(entry),
        "%s{\"x\":%ld,\"y\":%ld,\"width\":%ld,\"height\":%ld,"
        "\"visibleX\":%ld,\"visibleY\":%ld,\"visibleWidth\":%ld,\"visibleHeight\":%ld,"
        "\"scaleFactor\":%.2f,\"isPrimary\":%s}",
        sed->count > 0 ? "," : "",
        mi.rcMonitor.left, mi.rcMonitor.top,
        mi.rcMonitor.right - mi.rcMonitor.left,
        mi.rcMonitor.bottom - mi.rcMonitor.top,
        mi.rcWork.left, mi.rcWork.top,
        mi.rcWork.right - mi.rcWork.left,
        mi.rcWork.bottom - mi.rcWork.top,
        scaleFactor,
        isPrimary ? "true" : "false");

    strcat(sed->buf, entry);
    sed->count++;
    return TRUE;
}

static void handle_screen_list(const char *msg) {
    char msgId[64] = "0";
    json_extract_string(msg, "id", msgId, sizeof(msgId));

    ScreenEnumData sed;
    memset(&sed, 0, sizeof(sed));
    strcpy(sed.buf, "[");
    EnumDisplayMonitors(NULL, NULL, monitor_enum_proc, (LPARAM)&sed);
    strcat(sed.buf, "]");

    char resp[8192 + 256];
    snprintf(resp, sizeof(resp),
        "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"screen:list\",\"data\":%s}",
        msgId, sed.buf);
    ring_write_tb(resp, strlen(resp));
}

/* ---------- window:screenshot handler ---------- */

static void handle_window_screenshot(const char *msg) {
    char msgId[64] = "0";
    json_extract_string(msg, "id", msgId, sizeof(msgId));
    char savePath[MAX_PATH] = "";
    json_extract_string(msg, "path", savePath, sizeof(savePath));

    if (!savePath[0]) {
        char resp[256];
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"window:screenshot\",\"data\":{\"ok\":false}}",
            msgId);
        ring_write_tb(resp, strlen(resp));
        return;
    }

    RECT rc;
    GetClientRect(g_hwnd, &rc);
    int w = rc.right - rc.left;
    int h = rc.bottom - rc.top;

    HDC hdcWin = GetDC(g_hwnd);
    HDC hdcMem = CreateCompatibleDC(hdcWin);
    HBITMAP hbmp = CreateCompatibleBitmap(hdcWin, w, h);
    SelectObject(hdcMem, hbmp);
    BitBlt(hdcMem, 0, 0, w, h, hdcWin, 0, 0, SRCCOPY);

    /* Write BMP to file (simple approach — BMP format) */
    BITMAPINFOHEADER bi;
    memset(&bi, 0, sizeof(bi));
    bi.biSize = sizeof(BITMAPINFOHEADER);
    bi.biWidth = w;
    bi.biHeight = -h; /* top-down */
    bi.biPlanes = 1;
    bi.biBitCount = 24;
    bi.biCompression = BI_RGB;

    int rowSize = ((w * 3 + 3) & ~3);
    int dataSize = rowSize * h;
    unsigned char *pixels = (unsigned char *)malloc(dataSize);
    GetDIBits(hdcMem, hbmp, 0, h, pixels, (BITMAPINFO *)&bi, DIB_RGB_COLORS);

    /* Write as BMP file (the path might end in .png but we produce BMP for simplicity
     * without pulling in a PNG encoder — consumers can convert) */
    BITMAPFILEHEADER bf;
    memset(&bf, 0, sizeof(bf));
    bf.bfType = 0x4D42; /* 'BM' */
    bf.bfSize = sizeof(BITMAPFILEHEADER) + sizeof(BITMAPINFOHEADER) + dataSize;
    bf.bfOffBits = sizeof(BITMAPFILEHEADER) + sizeof(BITMAPINFOHEADER);

    wchar_t *wpath = utf8_to_wide(savePath);
    HANDLE hFile = CreateFileW(wpath, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    int ok = 0;
    if (hFile != INVALID_HANDLE_VALUE) {
        DWORD written;
        WriteFile(hFile, &bf, sizeof(bf), &written, NULL);
        WriteFile(hFile, &bi, sizeof(bi), &written, NULL);
        WriteFile(hFile, pixels, dataSize, &written, NULL);
        CloseHandle(hFile);
        ok = 1;
    }
    free(wpath);
    free(pixels);
    DeleteObject(hbmp);
    DeleteDC(hdcMem);
    ReleaseDC(g_hwnd, hdcWin);

    char resp[MAX_PATH * 2 + 256];
    if (ok) {
        /* Escape backslashes in path */
        char pathEscaped[MAX_PATH * 2];
        int ei = 0;
        for (int j = 0; savePath[j] && ei < (int)sizeof(pathEscaped) - 2; j++) {
            if (savePath[j] == '\\') { pathEscaped[ei++] = '\\'; pathEscaped[ei++] = '\\'; }
            else pathEscaped[ei++] = savePath[j];
        }
        pathEscaped[ei] = '\0';
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"window:screenshot\",\"data\":{\"ok\":true,\"path\":\"%s\"}}",
            msgId, pathEscaped);
    } else {
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"window:screenshot\",\"data\":{\"ok\":false}}",
            msgId);
    }
    ring_write_tb(resp, strlen(resp));
}

/* ---------- menu:set handler ---------- */

static void handle_menu_set(const char *msg) {
    /* Destroy old menu */
    if (g_app_menu) { DestroyMenu(g_app_menu); g_app_menu = NULL; }
    g_menu_action_count = 0;

    g_app_menu = CreateMenu();
    if (!g_app_menu) return;

    /* Parse menus from JSON data.
     * Format: {"data":[{"label":"File","items":[{"label":"Quit","action":"app:quit"},...]}, ...]}
     * We do simple sequential parsing. */
    const char *pos = strstr(msg, "\"data\":");
    if (!pos) { SetMenu(g_hwnd, g_app_menu); DrawMenuBar(g_hwnd); return; }

    /* Iterate over top-level menu sections */
    const char *section = pos;
    while ((section = strstr(section, "\"label\":\"")) != NULL) {
        char sectionLabel[128];
        const char *start = section + 9;
        const char *end = strchr(start, '"');
        if (!end) break;
        size_t len = (size_t)(end - start);
        if (len >= sizeof(sectionLabel)) len = sizeof(sectionLabel) - 1;
        memcpy(sectionLabel, start, len);
        sectionLabel[len] = '\0';
        section = end + 1;

        /* Find items array for this section */
        const char *items = strstr(section, "\"items\":");
        if (!items) continue;
        items += 8;

        /* Find the end of this items array */
        int depth = 0;
        const char *arrEnd = items;
        if (*arrEnd == '[') {
            depth = 1;
            arrEnd++;
            while (*arrEnd && depth > 0) {
                if (*arrEnd == '[') depth++;
                else if (*arrEnd == ']') depth--;
                arrEnd++;
            }
        }

        HMENU hSub = CreatePopupMenu();
        const char *item = items;
        while (item < arrEnd && (item = strstr(item, "\"label\":\"")) != NULL && item < arrEnd) {
            /* Check for separator first */
            const char *sepCheck = item - 30;
            if (sepCheck < items) sepCheck = items;

            char itemLabel[128];
            start = item + 9;
            end = strchr(start, '"');
            if (!end || end > arrEnd) break;
            len = (size_t)(end - start);
            if (len >= sizeof(itemLabel)) len = sizeof(itemLabel) - 1;
            memcpy(itemLabel, start, len);
            itemLabel[len] = '\0';
            item = end + 1;

            char action[128] = "";
            json_extract_string(item, "action", action, sizeof(action));

            if (action[0] && g_menu_action_count < MAX_MENU_ACTIONS) {
                int cmdId = 2000 + g_menu_action_count;
                wchar_t *wlabel = utf8_to_wide(itemLabel);
                if (wlabel) {
                    AppendMenuW(hSub, MF_STRING, cmdId, wlabel);
                    free(wlabel);
                }
                strncpy(g_menu_actions[g_menu_action_count], action, sizeof(g_menu_actions[0]) - 1);
                g_menu_actions[g_menu_action_count][sizeof(g_menu_actions[0]) - 1] = '\0';
                g_menu_action_count++;
            }
        }

        /* Check for separator items */
        const char *sepPos = items;
        while (sepPos < arrEnd && (sepPos = strstr(sepPos, "\"separator\"")) != NULL && sepPos < arrEnd) {
            /* This is a rough heuristic; separators are appended at end. */
            sepPos += 11;
        }

        wchar_t *wsectionLabel = utf8_to_wide(sectionLabel);
        if (wsectionLabel) {
            AppendMenuW(g_app_menu, MF_POPUP, (UINT_PTR)hSub, wsectionLabel);
            free(wsectionLabel);
        }

        section = (arrEnd > section) ? arrEnd : section;
    }

    SetMenu(g_hwnd, g_app_menu);
    DrawMenuBar(g_hwnd);
}

/* ---------- window:create handler ---------- */

/* Forward declaration — we need the controller/env for new windows */
static void handle_window_create(const char *msg) {
    char msgId[64] = "0";
    json_extract_string(msg, "id", msgId, sizeof(msgId));
    char windowId[64] = "0";
    json_extract_string(msg, "windowId", windowId, sizeof(windowId));
    char winTitle[256] = "Butter";
    json_extract_string(msg, "title", winTitle, sizeof(winTitle));
    char url[1024] = "";
    json_extract_string(msg, "url", url, sizeof(url));
    double width = json_extract_number(msg, "width", 800);
    double height = json_extract_number(msg, "height", 600);
    double x = json_extract_number(msg, "x", (double)CW_USEDEFAULT);
    double y = json_extract_number(msg, "y", (double)CW_USEDEFAULT);

    if (g_child_count >= MAX_WINDOWS) {
        char resp[512];
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"window:create\",\"error\":\"max windows reached\"}",
            msgId);
        ring_write_tb(resp, strlen(resp));
        return;
    }

    /* Create a new HWND */
    wchar_t *wwinTitle = utf8_to_wide(winTitle);
    HWND childHwnd = CreateWindowExW(
        0,
        L"ButterWindow",
        wwinTitle ? wwinTitle : L"Butter",
        WS_OVERLAPPEDWINDOW,
        (int)x, (int)y,
        (int)width, (int)height,
        NULL, NULL,
        GetModuleHandleW(NULL),
        NULL);
    free(wwinTitle);

    if (!childHwnd) {
        char resp[512];
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"window:create\",\"error\":\"failed to create window\"}",
            msgId);
        ring_write_tb(resp, strlen(resp));
        return;
    }

    ShowWindow(childHwnd, SW_SHOW);
    UpdateWindow(childHwnd);

    /* Store in children array (WebView2 will be created async via environment) */
    ChildWindow *cw = &g_children[g_child_count];
    strncpy(cw->id, windowId, sizeof(cw->id) - 1);
    cw->id[sizeof(cw->id) - 1] = '\0';
    cw->hwnd = childHwnd;
    cw->controller = NULL;
    cw->webview = NULL;
    g_child_count++;

    /* Create WebView2 controller for the new window.
     * We reuse the existing environment g_env. */
    if (g_env) {
        ControllerCreatedHandler *cch = create_controller_handler();
        g_env->lpVtbl->CreateCoreWebView2Controller(g_env, childHwnd, (void *)cch);
    }

    /* Send response */
    char resp[512];
    snprintf(resp, sizeof(resp),
        "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"window:create\",\"data\":{\"windowId\":\"%s\"}}",
        msgId, windowId);
    ring_write_tb(resp, strlen(resp));
}

/* ---------- deep linking: check command line ---------- */

static void check_deeplink_args(void) {
    const char *scheme = getenv("BUTTER_SCHEME");
    if (!scheme || !scheme[0]) return;
    strncpy(g_deeplink_scheme, scheme, sizeof(g_deeplink_scheme) - 1);

    /* Check if any command line arg matches the scheme */
    int argc = 0;
    LPWSTR *argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (!argv) return;

    for (int i = 1; i < argc; i++) {
        char *arg = wide_to_utf8(argv[i]);
        if (arg && strstr(arg, g_deeplink_scheme) == arg) {
            /* Escape for JSON */
            char escaped[2048];
            int ei = 0;
            for (int j = 0; arg[j] && ei < (int)sizeof(escaped) - 2; j++) {
                if (arg[j] == '\\') { escaped[ei++] = '\\'; escaped[ei++] = '\\'; }
                else if (arg[j] == '"') { escaped[ei++] = '\\'; escaped[ei++] = '"'; }
                else escaped[ei++] = arg[j];
            }
            escaped[ei] = '\0';

            char json[2048 + 128];
            snprintf(json, sizeof(json),
                "{\"id\":\"0\",\"type\":\"event\",\"action\":\"app:openurl\",\"data\":{\"url\":\"%s\"}}",
                escaped);
            ring_write_tb(json, strlen(json));
        }
        free(arg);
    }
    LocalFree(argv);
}

/* ---------- handle WM_COPYDATA for deep linking from second instance ---------- */

static void handle_copydata(HWND hwnd, LPARAM lp) {
    (void)hwnd;
    COPYDATASTRUCT *cds = (COPYDATASTRUCT *)lp;
    if (!cds || !cds->lpData || cds->cbData == 0) return;

    char *url = (char *)malloc(cds->cbData + 1);
    memcpy(url, cds->lpData, cds->cbData);
    url[cds->cbData] = '\0';

    /* Verify it matches our scheme */
    if (g_deeplink_scheme[0] && strstr(url, g_deeplink_scheme) != url) {
        free(url);
        return;
    }

    /* Escape for JSON */
    char escaped[2048];
    int ei = 0;
    for (int j = 0; url[j] && ei < (int)sizeof(escaped) - 2; j++) {
        if (url[j] == '\\') { escaped[ei++] = '\\'; escaped[ei++] = '\\'; }
        else if (url[j] == '"') { escaped[ei++] = '\\'; escaped[ei++] = '"'; }
        else escaped[ei++] = url[j];
    }
    escaped[ei] = '\0';

    char json[2048 + 128];
    snprintf(json, sizeof(json),
        "{\"id\":\"0\",\"type\":\"event\",\"action\":\"app:openurl\",\"data\":{\"url\":\"%s\"}}",
        escaped);
    ring_write_tb(json, strlen(json));
    free(url);
}

/* ---------- webview dialog helpers (for webview-side invocations) ---------- */

static void handle_webview_dialog(const char *msg) {
    if (strstr(msg, "\"dialog:open\"")) {
        handle_dialog_open(msg);
        /* Re-route the response to the webview instead of to-bun ring.
         * For simplicity, the handler already writes to ring_write_tb.
         * The response will be delivered to webview via the normal poll cycle.
         * But for direct webview invocations, we need to inject directly. */
    } else if (strstr(msg, "\"dialog:save\"")) {
        handle_dialog_save(msg);
    } else if (strstr(msg, "\"dialog:folder\"")) {
        handle_dialog_folder(msg);
    }
}

/* ---------- poll to-shim ring buffer ---------- */

static void poll_to_shim(void) {
    char *msg;
    while ((msg = ring_read_ts()) != NULL) {
        /* control messages */
        if (strstr(msg, "\"type\":\"control\"")) {
            if (strstr(msg, "\"quit\"")) {
                free(msg);
                PostQuitMessage(0);
                return;
            }
            if (strstr(msg, "\"reload\"")) {
                free(msg);
                if (g_webview) g_webview->lpVtbl->Reload(g_webview);
                continue;
            }
            if (strstr(msg, "\"window:print\"")) {
                if (g_webview) {
                    ScriptCompletedHandler *esh = create_execute_script_handler();
                    g_webview->lpVtbl->ExecuteScript(g_webview, L"window.print()", (void *)esh);
                }
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:maximize\"")) {
                ShowWindow(g_hwnd, SW_MAXIMIZE);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:minimize\"")) {
                ShowWindow(g_hwnd, SW_MINIMIZE);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:restore\"")) {
                ShowWindow(g_hwnd, SW_RESTORE);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:fullscreen\"")) {
                if (strstr(msg, "\"enable\":true")) {
                    ShowWindow(g_hwnd, SW_MAXIMIZE);
                    SetWindowLongW(g_hwnd, GWL_STYLE, WS_POPUP | WS_VISIBLE);
                } else {
                    SetWindowLongW(g_hwnd, GWL_STYLE, WS_OVERLAPPEDWINDOW | WS_VISIBLE);
                    ShowWindow(g_hwnd, SW_RESTORE);
                }
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:alwaysontop\"")) {
                HWND level = strstr(msg, "\"enable\":true") ? HWND_TOPMOST : HWND_NOTOPMOST;
                SetWindowPos(g_hwnd, level, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:set\"")) {
                char title[256];
                if (json_extract_string(msg, "title", title, sizeof(title))) {
                    wchar_t *wtitle = utf8_to_wide(title);
                    if (wtitle) { SetWindowTextW(g_hwnd, wtitle); free(wtitle); }
                }
                double w = json_extract_number(msg, "width", -1);
                double h = json_extract_number(msg, "height", -1);
                if (w > 0 || h > 0) {
                    RECT rc;
                    GetWindowRect(g_hwnd, &rc);
                    int cw = (w > 0) ? (int)w : (rc.right - rc.left);
                    int ch = (h > 0) ? (int)h : (rc.bottom - rc.top);
                    SetWindowPos(g_hwnd, NULL, 0, 0, cw, ch, SWP_NOMOVE | SWP_NOZORDER);
                }
                double x = json_extract_number(msg, "x", -99999);
                double y = json_extract_number(msg, "y", -99999);
                if (x > -99999 || y > -99999) {
                    RECT rc;
                    GetWindowRect(g_hwnd, &rc);
                    int cx = (x > -99999) ? (int)x : rc.left;
                    int cy = (y > -99999) ? (int)y : rc.top;
                    SetWindowPos(g_hwnd, NULL, cx, cy, 0, 0, SWP_NOSIZE | SWP_NOZORDER);
                }
                free(msg);
                continue;
            }
            if (strstr(msg, "\"dialog:open\"") || strstr(msg, "\"dialog:save\"") || strstr(msg, "\"dialog:folder\"")) {
                if (strstr(msg, "\"dialog:open\"")) handle_dialog_open(msg);
                else if (strstr(msg, "\"dialog:save\"")) handle_dialog_save(msg);
                else handle_dialog_folder(msg);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"dialog:message\"")) {
                handle_dialog_message(msg, 0);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"tray:set\"")) {
                handle_tray_set(msg);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"tray:remove\"")) {
                handle_tray_remove();
                free(msg);
                continue;
            }
            if (strstr(msg, "\"screen:list\"")) {
                handle_screen_list(msg);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:screenshot\"")) {
                handle_window_screenshot(msg);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"menu:set\"")) {
                handle_menu_set(msg);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:create\"")) {
                handle_window_create(msg);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:close\"")) {
                char windowId[64] = "";
                json_extract_string(msg, "windowId", windowId, sizeof(windowId));
                for (int i = 0; i < g_child_count; i++) {
                    if (strcmp(g_children[i].id, windowId) == 0) {
                        if (g_children[i].hwnd) DestroyWindow(g_children[i].hwnd);
                        if (g_children[i].webview) g_children[i].webview->lpVtbl->Release(g_children[i].webview);
                        if (g_children[i].controller) g_children[i].controller->lpVtbl->Release(g_children[i].controller);
                        memmove(&g_children[i], &g_children[i + 1], (g_child_count - i - 1) * sizeof(ChildWindow));
                        g_child_count--;
                        break;
                    }
                }
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:ready\"")) {
                /* Swap from splash to main app */
                if (g_webview) {
                    g_webview->lpVtbl->Navigate(g_webview, g_html_url);
                }
                free(msg);
                continue;
            }
        }

        /* inject response/event into webview */
        if (g_webview) {
            wchar_t *escaped = escape_for_js(msg);
            size_t prefix_len = wcslen(L"window.__butterReceive('");
            size_t suffix_len = wcslen(L"')");
            size_t esc_len = wcslen(escaped);
            size_t jslen = prefix_len + esc_len + suffix_len + 1;
            wchar_t *js = (wchar_t *)malloc(jslen * sizeof(wchar_t));
            _snwprintf(js, jslen, L"window.__butterReceive('%s')", escaped);
            js[jslen - 1] = L'\0';

            ScriptCompletedHandler *esh = create_execute_script_handler();
            g_webview->lpVtbl->ExecuteScript(g_webview, js, (void *)esh);

            free(js);
            free(escaped);
        }
        free(msg);
    }
}

/* ---------- Win32 window procedure ---------- */

static LRESULT CALLBACK wnd_proc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
        case WM_SIZE:
            if (g_controller) {
                RECT bounds;
                GetClientRect(hwnd, &bounds);
                g_controller->lpVtbl->put_Bounds(g_controller, bounds);
            }
            /* Send resize event to host */
            if (hwnd == g_hwnd) {
                RECT rc;
                GetClientRect(hwnd, &rc);
                char json[256];
                snprintf(json, sizeof(json),
                    "{\"id\":\"0\",\"type\":\"event\",\"action\":\"window:resize\",\"data\":{\"width\":%ld,\"height\":%ld}}",
                    rc.right - rc.left, rc.bottom - rc.top);
                ring_write_tb(json, strlen(json));

                if (wp == SIZE_MINIMIZED) {
                    const char *ev = "{\"id\":\"0\",\"type\":\"event\",\"action\":\"window:minimize\"}";
                    ring_write_tb(ev, strlen(ev));
                } else if (wp == SIZE_RESTORED) {
                    const char *ev = "{\"id\":\"0\",\"type\":\"event\",\"action\":\"window:restore\"}";
                    ring_write_tb(ev, strlen(ev));
                }
            }
            return 0;

        case WM_MOVE:
            if (hwnd == g_hwnd) {
                RECT rc;
                GetWindowRect(hwnd, &rc);
                char json[256];
                snprintf(json, sizeof(json),
                    "{\"id\":\"0\",\"type\":\"event\",\"action\":\"window:move\",\"data\":{\"x\":%ld,\"y\":%ld}}",
                    rc.left, rc.top);
                ring_write_tb(json, strlen(json));
            }
            return 0;

        case WM_SETFOCUS:
            if (hwnd == g_hwnd) {
                const char *json = "{\"id\":\"0\",\"type\":\"event\",\"action\":\"window:focus\"}";
                ring_write_tb(json, strlen(json));
            }
            return 0;

        case WM_KILLFOCUS:
            if (hwnd == g_hwnd) {
                const char *json = "{\"id\":\"0\",\"type\":\"event\",\"action\":\"window:blur\"}";
                ring_write_tb(json, strlen(json));
            }
            return 0;

        case WM_TIMER:
            if (wp == POLL_TIMER_ID) {
                poll_to_shim();
            }
            return 0;

        case WM_COMMAND:
            /* Handle menu item clicks */
            if (HIWORD(wp) == 0) {
                int cmdId = LOWORD(wp);
                /* Tray menu actions: IDs 1..MAX_TRAY_ITEMS */
                if (cmdId >= 1 && cmdId <= g_tray_action_count) {
                    char json[512];
                    snprintf(json, sizeof(json),
                        "{\"id\":\"0\",\"type\":\"event\",\"action\":\"tray:action\",\"data\":{\"action\":\"%s\"}}",
                        g_tray_actions[cmdId - 1]);
                    ring_write_tb(json, strlen(json));
                    return 0;
                }
                /* App menu actions: IDs 2000+ */
                if (cmdId >= 2000 && cmdId < 2000 + g_menu_action_count) {
                    int idx = cmdId - 2000;
                    char json[512];
                    snprintf(json, sizeof(json),
                        "{\"id\":\"0\",\"type\":\"event\",\"action\":\"%s\"}",
                        g_menu_actions[idx]);
                    ring_write_tb(json, strlen(json));
                    return 0;
                }
            }
            break;

        case WM_TRAYICON:
            /* System tray icon messages */
            if (lp == WM_RBUTTONUP || lp == WM_LBUTTONUP) {
                if (g_tray_menu) {
                    POINT pt;
                    GetCursorPos(&pt);
                    SetForegroundWindow(hwnd);
                    TrackPopupMenuEx(g_tray_menu, TPM_LEFTALIGN | TPM_BOTTOMALIGN,
                        pt.x, pt.y, hwnd, NULL);
                    PostMessage(hwnd, WM_NULL, 0, 0);
                }
            }
            return 0;

        case WM_COPYDATA:
            /* Deep linking: another instance sends us a URL */
            handle_copydata(hwnd, lp);
            return 0;

        case WM_CLOSE: {
            const char *quit = "{\"id\":\"0\",\"type\":\"control\",\"action\":\"quit\"}";
            ring_write_tb(quit, strlen(quit));
            DestroyWindow(hwnd);
            return 0;
        }

        case WM_DESTROY:
            /* Clean up tray icon */
            if (g_tray_active) {
                Shell_NotifyIconW(NIM_DELETE, &g_nid);
                g_tray_active = 0;
            }
            if (g_tray_menu) { DestroyMenu(g_tray_menu); g_tray_menu = NULL; }
            KillTimer(hwnd, POLL_TIMER_ID);
            PostQuitMessage(0);
            return 0;

        default:
            return DefWindowProcW(hwnd, msg, wp, lp);
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

/* ---------- open shared memory ---------- */

static int open_shm(const char *name) {
    /* shared memory name: butter_<pid> (no leading slash on Windows) */
    char shm_name[256];
    snprintf(shm_name, sizeof(shm_name), "%s", name);

    g_hmap = OpenFileMappingA(FILE_MAP_ALL_ACCESS, FALSE, shm_name);
    if (!g_hmap) {
        fprintf(stderr, "[shim] OpenFileMappingA(%s) failed: %lu\n", shm_name, GetLastError());
        return -1;
    }

    g_shm = (uint8_t *)MapViewOfFile(g_hmap, FILE_MAP_ALL_ACCESS, 0, 0, SHM_SIZE);
    if (!g_shm) {
        fprintf(stderr, "[shim] MapViewOfFile failed: %lu\n", GetLastError());
        CloseHandle(g_hmap);
        return -1;
    }

    /* open named events: <name>_tb and <name>_ts */
    char evt_tb_name[270], evt_ts_name[270];
    snprintf(evt_tb_name, sizeof(evt_tb_name), "%s_tb", name);
    snprintf(evt_ts_name, sizeof(evt_ts_name), "%s_ts", name);

    g_evt_tb = OpenEventA(EVENT_MODIFY_STATE | SYNCHRONIZE, FALSE, evt_tb_name);
    g_evt_ts = OpenEventA(EVENT_MODIFY_STATE | SYNCHRONIZE, FALSE, evt_ts_name);
    if (!g_evt_tb || !g_evt_ts) {
        fprintf(stderr, "[shim] OpenEventA failed: %lu\n", GetLastError());
        return -1;
    }

    return 0;
}

/* ---------- build file:// URL from path ---------- */

static void build_file_url(const char *path) {
    /* get full path */
    char fullpath[MAX_PATH];
    GetFullPathNameA(path, MAX_PATH, fullpath, NULL);

    /* convert backslashes to forward slashes */
    for (char *p = fullpath; *p; p++) {
        if (*p == '\\') *p = '/';
    }

    /* build file:///C:/... URL */
    char url[MAX_PATH + 16];
    snprintf(url, sizeof(url), "file:///%s", fullpath);

    MultiByteToWideChar(CP_UTF8, 0, url, -1, g_html_url, MAX_PATH + 16);
}

/* ---------- main ---------- */

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: %s <shm-name> <html-path>\n", argv[0]);
        return 1;
    }

    const char *shm_name  = argv[1];
    const char *html_path = argv[2];
    const char *title_env = getenv("BUTTER_TITLE");
    if (title_env) {
        strncpy(g_title, title_env, sizeof(g_title) - 1);
        g_title[sizeof(g_title) - 1] = '\0';
    }

    /* open shared memory and events */
    if (open_shm(shm_name) != 0) return 1;

    /* build file URL for the HTML */
    build_file_url(html_path);

    /* initialize COM */
    HRESULT hr = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) {
        fprintf(stderr, "[shim] CoInitializeEx failed: 0x%08lx\n", hr);
        return 1;
    }

    /* register window class */
    wchar_t *wtitle = utf8_to_wide(g_title);

    WNDCLASSEXW wc = {0};
    wc.cbSize        = sizeof(WNDCLASSEXW);
    wc.lpfnWndProc   = wnd_proc;
    wc.hInstance      = GetModuleHandleW(NULL);
    wc.hCursor       = LoadCursorW(NULL, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName  = L"ButterWindow";
    RegisterClassExW(&wc);

    /* create window */
    g_hwnd = CreateWindowExW(
        0,
        L"ButterWindow",
        wtitle,
        WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, CW_USEDEFAULT,
        1024, 768,
        NULL, NULL,
        GetModuleHandleW(NULL),
        NULL
    );

    if (!g_hwnd) {
        fprintf(stderr, "[shim] CreateWindowEx failed: %lu\n", GetLastError());
        free(wtitle);
        return 1;
    }

    ShowWindow(g_hwnd, SW_SHOW);
    UpdateWindow(g_hwnd);

    /* create WebView2 environment (async) */
    EnvCreatedHandler *ech = create_env_handler();
    hr = CreateCoreWebView2EnvironmentWithOptions(NULL, NULL, NULL, (void *)ech);
    if (FAILED(hr)) {
        fprintf(stderr, "[shim] CreateCoreWebView2EnvironmentWithOptions failed: 0x%08lx\n", hr);
        free(wtitle);
        return 1;
    }

    /* Check command line for deep link URLs */
    check_deeplink_args();

    /* Win32 message loop */
    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    /* cleanup */
    if (g_webview)    g_webview->lpVtbl->Release(g_webview);
    if (g_controller) g_controller->lpVtbl->Release(g_controller);
    if (g_env)        g_env->lpVtbl->Release(g_env);

    if (g_shm)    UnmapViewOfFile(g_shm);
    if (g_hmap)   CloseHandle(g_hmap);
    if (g_evt_tb) CloseHandle(g_evt_tb);
    if (g_evt_ts) CloseHandle(g_evt_ts);

    CoUninitialize();
    free(wtitle);

    return (int)msg.wParam;
}

/*
 * Butter shim — Windows native window with WebView2
 * Pure C using Win32 + WebView2 COM interfaces
 *
 * Usage: shim.exe <shm-name> <html-path>
 * Env:   BUTTER_TITLE — window title (default: "Butter App")
 *
 * Compile (MSVC):  cl.exe windows.c /link ole32.lib user32.lib WebView2Loader.lib
 * Compile (MinGW): gcc -o shim.exe windows.c -lole32 -luser32 -lWebView2Loader
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
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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
      L"if(m.type==='response'){"
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
      L"on:function(a,h){if(!l.has(a))l.set(a,[]);l.get(a).push(h);},"
      L"off:function(a,h){var hs=l.get(a);if(!hs)return;var i=hs.indexOf(h);if(i!==-1)hs.splice(i,1);}"
    L"};"
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

typedef struct ScriptCompletedHandler {
    void *lpVtbl;
    LONG  refCount;
} ScriptCompletedHandler;

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

typedef struct ControllerCreatedHandler {
    void *lpVtbl;
    LONG  refCount;
} ControllerCreatedHandler;

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
            return 0;

        case WM_TIMER:
            if (wp == POLL_TIMER_ID) {
                poll_to_shim();
            }
            return 0;

        case WM_CLOSE: {
            const char *quit = "{\"id\":\"0\",\"type\":\"control\",\"action\":\"quit\"}";
            ring_write_tb(quit, strlen(quit));
            DestroyWindow(hwnd);
            return 0;
        }

        case WM_DESTROY:
            KillTimer(hwnd, POLL_TIMER_ID);
            PostQuitMessage(0);
            return 0;

        default:
            return DefWindowProcW(hwnd, msg, wp, lp);
    }
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

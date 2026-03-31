/*
 * Butter shim — Linux native window with GTK3 + WebKitGTK
 * Pure C for GTK/WebKit integration
 *
 * Usage: ./shim <shm-name> <html-path>
 * Env:   BUTTER_TITLE — window title (default: "Butter App")
 *        BUTTER_MENU  — JSON menu definition (optional, skipped in v0.1)
 *
 * Compile: cc -o shim linux.c $(pkg-config --cflags --libs gtk+-3.0 webkit2gtk-4.1 x11 gio-2.0 cairo)
 */

#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <gdk/gdkx.h>
#include <X11/Xlib.h>
#include <X11/XKBlib.h>
#include <gio/gio.h>
#include <cairo/cairo.h>
#include <sys/mman.h>
#include <fcntl.h>
#include <semaphore.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <unistd.h>
#include <ctype.h>
#include <X11/keysym.h>

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

/* ---------- globals ---------- */

static uint8_t *g_shm    = NULL;
static sem_t   *g_sem_tb = NULL;
static sem_t   *g_sem_ts = NULL;

static WebKitWebView *g_webview = NULL;
static GtkWidget     *g_window  = NULL;

/* ---------- system tray ---------- */

static GtkStatusIcon *g_tray_icon = NULL;
static GtkWidget     *g_tray_menu = NULL;

/* ---------- global shortcuts ---------- */

#define MAX_SHORTCUTS 64

typedef struct {
    char id[64];
    unsigned int modifiers;
    KeyCode keycode;
} RegisteredShortcut;

static RegisteredShortcut g_shortcuts[MAX_SHORTCUTS];
static int g_shortcut_count = 0;

/* ---------- deep link URL ---------- */

static char *g_deep_link_url = NULL;

/* ---------- power/sleep via logind ---------- */

static GDBusConnection *g_logind_conn = NULL;
static guint g_logind_signal_id = 0;

/* ---------- forward declarations ---------- */

static void handle_message_dialog(const char *msg, int from_webview);
static int json_extract_string(const char *json, const char *key, char *out, size_t outlen);
static double json_extract_number(const char *json, const char *key, double fallback);
static int json_extract_bool(const char *json, const char *key, int fallback);

/* ---------- secondary window tracking ---------- */

#define MAX_WINDOWS 64

typedef struct {
    char id[64];
    GtkWidget *window;
    WebKitWebView *webview;
} ButterWindow;

static ButterWindow g_windows[MAX_WINDOWS];
static int g_window_count = 0;

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
    sem_post(g_sem_tb);
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

    char *buf = malloc(len + 1);
    for (uint32_t i = 0; i < len; i++)
        buf[i] = (char)g_shm[RING_TS_OFF + ((rcur + MSG_HDR + i) % RING_SIZE)];
    buf[len] = '\0';

    write_u32(g_shm + TS_RCUR, (rcur + MSG_HDR + len) % RING_SIZE);
    return buf;
}

/* ---------- bridge JS ---------- */

static const char *BRIDGE_JS =
    "(function(){"
    "var p=new Map(),n=1,l=new Map();"
    "window.__butterReceive=function(j){"
      "var m=JSON.parse(j);"
      "if(m.type==='response'&&m.action==='chunk'&&m.data){"
        "var e=p.get(m.data.id);if(e&&e.onChunk)e.onChunk(m.data.data);}"
      "else if(m.type==='response'){"
        "var r=p.get(m.id);if(r){p.delete(m.id);"
        "if(m.error)r.reject(new Error(m.error));else r.resolve(m.data);}}"
      "else if(m.type==='event'){"
        "var h=l.get(m.action)||[];for(var i=0;i<h.length;i++)h[i](m.data);}"
    "};"
    "var send=function(m){"
      "window.webkit.messageHandlers.butter.postMessage(JSON.stringify(m));"
    "};"
    "window.butter={"
      "invoke:function(a,d){return new Promise(function(res,rej){"
        "var id=String(n++);p.set(id,{resolve:res,reject:rej});"
        "send({id:id,type:'invoke',action:a,data:d});});},"
      "stream:function(a,d,cb){return new Promise(function(res,rej){"
        "var id=String(n++),e={resolve:res,reject:rej,timer:null,onChunk:cb};"
        "p.set(id,e);send({id:id,type:'invoke',action:a,data:d,stream:true});});},"
      "on:function(a,h){if(!l.has(a))l.set(a,[]);l.get(a).push(h);}"
    "};"
    "document.addEventListener('dragover',function(e){e.preventDefault();});"
    "document.addEventListener('drop',function(e){"
      "e.preventDefault();"
      "var f=[];if(e.dataTransfer&&e.dataTransfer.files){"
        "for(var i=0;i<e.dataTransfer.files.length;i++){"
          "var x=e.dataTransfer.files[i];f.push({name:x.name,size:x.size,type:x.type,path:x.path||''});}}"
      "if(f.length>0)send({id:String(n++),type:'event',action:'drop:files',data:f});"
    "});"
    "})();";

/* ---------- escape JSON for JS injection ---------- */

static char *escape_for_js(const char *json) {
    size_t len = strlen(json);
    /* worst case: every char needs escaping */
    char *out = malloc(len * 2 + 1);
    size_t j = 0;

    for (size_t i = 0; i < len; i++) {
        switch (json[i]) {
            case '\\': out[j++] = '\\'; out[j++] = '\\'; break;
            case '\'': out[j++] = '\\'; out[j++] = '\''; break;
            case '\n': out[j++] = '\\'; out[j++] = 'n';  break;
            case '\r': out[j++] = '\\'; out[j++] = 'r';  break;
            default:   out[j++] = json[i]; break;
        }
    }
    out[j] = '\0';
    return out;
}

/* ---------- context menu handling ---------- */

static void on_context_menu_item_activate(GtkMenuItem *menuitem, gpointer user_data) {
    const char *action = (const char *)g_object_get_data(G_OBJECT(menuitem), "action");
    const char *msgId = (const char *)user_data;
    if (!action || !msgId) return;

    char json[512];
    snprintf(json, sizeof(json),
        "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"__contextmenu\",\"data\":\"%s\"}",
        msgId, action);
    ring_write_tb(json, strlen(json));
}

static void handle_context_menu(const char *msg) {
    /* Extract msgId */
    char msgId[64] = "0";
    json_extract_string(msg, "id", msgId, sizeof(msgId));

    GtkWidget *menu = gtk_menu_new();

    /* Simple parsing: find each "label" and "action" pair */
    const char *pos = msg;
    while ((pos = strstr(pos, "\"label\":\"")) != NULL) {
        char label[128], action[128];
        pos += 9; /* skip "label":" */
        const char *end = strchr(pos, '"');
        if (!end) break;
        size_t len = (size_t)(end - pos);
        if (len >= sizeof(label)) len = sizeof(label) - 1;
        memcpy(label, pos, len);
        label[len] = '\0';
        pos = end + 1;

        /* Find the corresponding action */
        if (json_extract_string(pos - 64, "action", action, sizeof(action)) ||
            json_extract_string(pos, "action", action, sizeof(action))) {
            GtkWidget *item = gtk_menu_item_new_with_label(label);
            char *action_dup = strdup(action);
            g_object_set_data_full(G_OBJECT(item), "action", action_dup, free);
            char *msgId_dup = strdup(msgId);
            g_signal_connect(item, "activate", G_CALLBACK(on_context_menu_item_activate), msgId_dup);
            gtk_menu_shell_append(GTK_MENU_SHELL(menu), item);
        }
    }

    gtk_widget_show_all(menu);
    gtk_menu_popup_at_pointer(GTK_MENU(menu), NULL);
}

/* ---------- forward declarations ---------- */

static void handle_file_dialog_open(const char *msg, int from_webview);
static void handle_file_dialog_save(const char *msg, int from_webview);
static void handle_file_dialog_folder(const char *msg, int from_webview);

/* ---------- script message handler ---------- */

static void on_script_message(WebKitUserContentManager *manager,
                              WebKitJavascriptResult *result,
                              gpointer user_data) {
    (void)manager;
    (void)user_data;

    JSCValue *val = webkit_javascript_result_get_js_value(result);
    if (!jsc_value_is_string(val)) return;

    char *str = jsc_value_to_string(val);
    if (str) {
        /* Intercept context menu requests */
        if (strstr(str, "\"__contextmenu\"")) {
            handle_context_menu(str);
            g_free(str);
            return;
        }
        /* Intercept file dialog requests from webview */
        if (strstr(str, "\"dialog:open\"")) {
            handle_file_dialog_open(str, 1);
            g_free(str);
            return;
        }
        if (strstr(str, "\"dialog:save\"")) {
            handle_file_dialog_save(str, 1);
            g_free(str);
            return;
        }
        if (strstr(str, "\"dialog:folder\"")) {
            handle_file_dialog_folder(str, 1);
            g_free(str);
            return;
        }
        /* Intercept message dialog requests */
        if (strstr(str, "\"dialog:message\"")) {
            handle_message_dialog(str, 1);
            g_free(str);
            return;
        }
        ring_write_tb(str, strlen(str));
        g_free(str);
    }
}

/* ---------- minimal JSON value extraction ---------- */

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

/* ---------- secondary window close handler ---------- */

static gboolean on_secondary_window_close(GtkWidget *widget, GdkEvent *event, gpointer data) {
    (void)event;
    char *windowId = (char *)data;
    char json[256];
    snprintf(json, sizeof(json),
        "{\"id\":\"0\",\"type\":\"event\",\"action\":\"window:closed\",\"data\":{\"windowId\":\"%s\"}}",
        windowId);
    ring_write_tb(json, strlen(json));

    for (int i = 0; i < g_window_count; i++) {
        if (strcmp(g_windows[i].id, windowId) == 0) {
            memmove(&g_windows[i], &g_windows[i+1], (g_window_count - i - 1) * sizeof(ButterWindow));
            g_window_count--;
            break;
        }
    }
    return FALSE;
}

/* ---------- window management handlers ---------- */

static void handle_window_create(const char *json) {
    if (g_window_count >= MAX_WINDOWS) return;

    char windowId[64] = "0", url[512] = "butter://app/index.html", title[256] = "Butter";
    json_extract_string(json, "windowId", windowId, sizeof(windowId));
    json_extract_string(json, "url", url, sizeof(url));
    json_extract_string(json, "title", title, sizeof(title));
    int width = (int)json_extract_number(json, "width", 800);
    int height = (int)json_extract_number(json, "height", 600);
    int frameless = json_extract_bool(json, "frameless", 0);
    int alwaysOnTop = json_extract_bool(json, "alwaysOnTop", 0);

    GtkWidget *win = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(win), title);
    gtk_window_set_default_size(GTK_WINDOW(win), width, height);

    if (frameless) {
        gtk_window_set_decorated(GTK_WINDOW(win), FALSE);
    }
    if (alwaysOnTop) {
        gtk_window_set_keep_above(GTK_WINDOW(win), TRUE);
    }

    ButterWindow *bw = &g_windows[g_window_count];
    strncpy(bw->id, windowId, sizeof(bw->id) - 1);
    bw->id[sizeof(bw->id) - 1] = '\0';

    g_signal_connect(win, "delete-event", G_CALLBACK(on_secondary_window_close), bw->id);

    WebKitUserContentManager *ucm = webkit_user_content_manager_new();
    WebKitUserScript *script = webkit_user_script_new(
        BRIDGE_JS, WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES,
        WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START, NULL, NULL);
    webkit_user_content_manager_add_script(ucm, script);
    webkit_user_script_unref(script);
    g_signal_connect(ucm, "script-message-received::butter", G_CALLBACK(on_script_message), NULL);
    webkit_user_content_manager_register_script_message_handler(ucm, "butter");

    WebKitWebView *webview = WEBKIT_WEB_VIEW(webkit_web_view_new_with_user_content_manager(ucm));
    gtk_container_add(GTK_CONTAINER(win), GTK_WIDGET(webview));

    bw->window = win;
    bw->webview = webview;
    g_window_count++;

    webkit_web_view_load_uri(webview, url);
    gtk_widget_show_all(win);

    /* Send response */
    char resp[256];
    char msgId[64] = "0";
    json_extract_string(json, "id", msgId, sizeof(msgId));
    snprintf(resp, sizeof(resp),
        "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"window:create\",\"data\":{\"windowId\":\"%s\"}}",
        msgId, windowId);
    ring_write_tb(resp, strlen(resp));
}

static void handle_window_set(const char *json) {
    char title[256];
    if (json_extract_string(json, "title", title, sizeof(title))) {
        gtk_window_set_title(GTK_WINDOW(g_window), title);
    }

    double w = json_extract_number(json, "width", -1);
    double h = json_extract_number(json, "height", -1);
    if (w > 0 || h > 0) {
        int cw, ch;
        gtk_window_get_size(GTK_WINDOW(g_window), &cw, &ch);
        gtk_window_resize(GTK_WINDOW(g_window), w > 0 ? (int)w : cw, h > 0 ? (int)h : ch);
    }

    double x = json_extract_number(json, "x", -99999);
    double y = json_extract_number(json, "y", -99999);
    if (x > -99999 || y > -99999) {
        int cx, cy;
        gtk_window_get_position(GTK_WINDOW(g_window), &cx, &cy);
        gtk_window_move(GTK_WINDOW(g_window), x > -99999 ? (int)x : cx, y > -99999 ? (int)y : cy);
    }
}

/* ---------- message dialog ---------- */

static void handle_message_dialog(const char *msg, int from_webview) {
    char msgId[64] = "0", title[256] = "", message[512] = "", detail[512] = "", type[32] = "info";
    json_extract_string(msg, "id", msgId, sizeof(msgId));

    /* Extract from nested data object */
    const char *data_start = strstr(msg, "\"data\":{");
    const char *search = data_start ? data_start : msg;

    json_extract_string(search, "title", title, sizeof(title));
    json_extract_string(search, "message", message, sizeof(message));
    json_extract_string(search, "detail", detail, sizeof(detail));
    json_extract_string(search, "type", type, sizeof(type));

    GtkMessageType msgType = GTK_MESSAGE_INFO;
    if (strcmp(type, "warning") == 0) msgType = GTK_MESSAGE_WARNING;
    else if (strcmp(type, "error") == 0) msgType = GTK_MESSAGE_ERROR;

    GtkWidget *dlg = gtk_message_dialog_new(
        GTK_WINDOW(g_window), GTK_DIALOG_MODAL,
        msgType, GTK_BUTTONS_NONE, "%s", message);

    if (strlen(title) > 0) gtk_window_set_title(GTK_WINDOW(dlg), title);
    if (strlen(detail) > 0) {
        gtk_message_dialog_format_secondary_text(GTK_MESSAGE_DIALOG(dlg), "%s", detail);
    }

    /* Parse buttons array — simple approach: find "buttons":["...","..."] */
    const char *btns = strstr(search, "\"buttons\":[");
    int btnCount = 0;
    if (btns) {
        btns += 11; /* skip "buttons":[ */
        while (btnCount < 8) {
            while (*btns == ' ' || *btns == '"') btns++;
            if (*btns == ']' || *btns == '\0') break;
            const char *end = strchr(btns, '"');
            if (!end) break;
            char label[64];
            size_t len = (size_t)(end - btns);
            if (len >= sizeof(label)) len = sizeof(label) - 1;
            memcpy(label, btns, len);
            label[len] = '\0';
            gtk_dialog_add_button(GTK_DIALOG(dlg), label, btnCount);
            btnCount++;
            btns = end + 1;
            if (*btns == ',') btns++;
        }
    }
    if (btnCount == 0) {
        gtk_dialog_add_button(GTK_DIALOG(dlg), "OK", 0);
    }

    int result = gtk_dialog_run(GTK_DIALOG(dlg));
    gtk_widget_destroy(dlg);

    char resp[256];
    snprintf(resp, sizeof(resp),
        "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"dialog:message\",\"data\":{\"button\":%d,\"cancelled\":false}}",
        msgId, result >= 0 ? result : 0);

    if (from_webview && g_webview) {
        char *escaped = escape_for_js(resp);
        size_t jslen = strlen(escaped) + 64;
        char *js = malloc(jslen);
        snprintf(js, jslen, "window.__butterReceive('%s')", escaped);
        webkit_web_view_run_javascript(g_webview, js, NULL, NULL, NULL);
        free(js);
        free(escaped);
    } else {
        ring_write_tb(resp, strlen(resp));
    }
}

/* ---------- file dialog helpers ---------- */

static void handle_file_dialog_open(const char *msg, int from_webview) {
    char msgId[64] = "0", title[256] = "Open File", prompt[256] = "";
    json_extract_string(msg, "id", msgId, sizeof(msgId));

    const char *data_start = strstr(msg, "\"data\":{");
    const char *search = data_start ? data_start : msg;

    json_extract_string(search, "title", title, sizeof(title));
    json_extract_string(search, "prompt", prompt, sizeof(prompt));
    int multiple = json_extract_bool(search, "multiple", 0);

    GtkWidget *dlg = gtk_file_chooser_dialog_new(
        title, GTK_WINDOW(g_window), GTK_FILE_CHOOSER_ACTION_OPEN,
        "_Cancel", GTK_RESPONSE_CANCEL,
        strlen(prompt) > 0 ? prompt : "_Open", GTK_RESPONSE_ACCEPT,
        NULL);

    gtk_file_chooser_set_select_multiple(GTK_FILE_CHOOSER(dlg), multiple);

    /* Parse filters: [{"name":"Images","extensions":["png","jpg"]}] */
    const char *fpos = strstr(search, "\"filters\":[");
    if (fpos) {
        fpos += 11;
        while (*fpos != ']' && *fpos != '\0') {
            char fname[128] = "", exts_buf[512] = "";
            const char *name_start = strstr(fpos, "\"name\":\"");
            if (name_start && name_start < strstr(fpos, "}")) {
                name_start += 8;
                const char *name_end = strchr(name_start, '"');
                if (name_end) {
                    size_t nl = (size_t)(name_end - name_start);
                    if (nl >= sizeof(fname)) nl = sizeof(fname) - 1;
                    memcpy(fname, name_start, nl);
                    fname[nl] = '\0';
                }
            }
            const char *ext_arr = strstr(fpos, "\"extensions\":[");
            if (ext_arr) {
                ext_arr += 14;
                GtkFileFilter *filter = gtk_file_filter_new();
                if (strlen(fname) > 0) gtk_file_filter_set_name(filter, fname);
                while (*ext_arr != ']' && *ext_arr != '\0') {
                    if (*ext_arr == '"') {
                        ext_arr++;
                        const char *eend = strchr(ext_arr, '"');
                        if (eend) {
                            char pat[64];
                            size_t elen = (size_t)(eend - ext_arr);
                            if (elen < sizeof(pat) - 3) {
                                snprintf(pat, sizeof(pat), "*.%.*s", (int)elen, ext_arr);
                                gtk_file_filter_add_pattern(filter, pat);
                            }
                            ext_arr = eend + 1;
                        } else break;
                    } else ext_arr++;
                }
                gtk_file_chooser_add_filter(GTK_FILE_CHOOSER(dlg), filter);
            }
            const char *next_obj = strstr(fpos + 1, "{");
            if (!next_obj || next_obj > strstr(fpos, "]}") + 1) break;
            fpos = next_obj;
        }
    }

    int result = gtk_dialog_run(GTK_DIALOG(dlg));

    /* Build paths JSON array */
    char resp[4096];
    size_t off = 0;

    if (result == GTK_RESPONSE_ACCEPT) {
        GSList *files = gtk_file_chooser_get_filenames(GTK_FILE_CHOOSER(dlg));
        off += (size_t)snprintf(resp + off, sizeof(resp) - off,
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"dialog:open\",\"data\":{\"paths\":[", msgId);
        GSList *iter = files;
        int first = 1;
        while (iter) {
            if (!first) off += (size_t)snprintf(resp + off, sizeof(resp) - off, ",");
            off += (size_t)snprintf(resp + off, sizeof(resp) - off, "\"%s\"", (char *)iter->data);
            g_free(iter->data);
            iter = iter->next;
            first = 0;
        }
        off += (size_t)snprintf(resp + off, sizeof(resp) - off, "],\"cancelled\":false}}");
        g_slist_free(files);
    } else {
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"dialog:open\",\"data\":{\"paths\":[],\"cancelled\":true}}",
            msgId);
    }

    gtk_widget_destroy(dlg);

    if (from_webview && g_webview) {
        char *escaped = escape_for_js(resp);
        size_t jslen = strlen(escaped) + 64;
        char *js = malloc(jslen);
        snprintf(js, jslen, "window.__butterReceive('%s')", escaped);
        webkit_web_view_run_javascript(g_webview, js, NULL, NULL, NULL);
        free(js);
        free(escaped);
    } else {
        ring_write_tb(resp, strlen(resp));
    }
}

static void handle_file_dialog_save(const char *msg, int from_webview) {
    char msgId[64] = "0", title[256] = "Save File", prompt[256] = "", defaultName[256] = "", defaultPath[512] = "";
    json_extract_string(msg, "id", msgId, sizeof(msgId));

    const char *data_start = strstr(msg, "\"data\":{");
    const char *search = data_start ? data_start : msg;

    json_extract_string(search, "title", title, sizeof(title));
    json_extract_string(search, "prompt", prompt, sizeof(prompt));
    json_extract_string(search, "defaultName", defaultName, sizeof(defaultName));
    json_extract_string(search, "defaultPath", defaultPath, sizeof(defaultPath));

    GtkWidget *dlg = gtk_file_chooser_dialog_new(
        title, GTK_WINDOW(g_window), GTK_FILE_CHOOSER_ACTION_SAVE,
        "_Cancel", GTK_RESPONSE_CANCEL,
        strlen(prompt) > 0 ? prompt : "_Save", GTK_RESPONSE_ACCEPT,
        NULL);

    gtk_file_chooser_set_do_overwrite_confirmation(GTK_FILE_CHOOSER(dlg), TRUE);

    if (strlen(defaultName) > 0)
        gtk_file_chooser_set_current_name(GTK_FILE_CHOOSER(dlg), defaultName);
    if (strlen(defaultPath) > 0)
        gtk_file_chooser_set_current_folder(GTK_FILE_CHOOSER(dlg), defaultPath);

    int result = gtk_dialog_run(GTK_DIALOG(dlg));
    char resp[2048];

    if (result == GTK_RESPONSE_ACCEPT) {
        char *filename = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dlg));
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"dialog:save\",\"data\":{\"path\":\"%s\",\"cancelled\":false}}",
            msgId, filename ? filename : "");
        g_free(filename);
    } else {
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"dialog:save\",\"data\":{\"path\":\"\",\"cancelled\":true}}",
            msgId);
    }

    gtk_widget_destroy(dlg);

    if (from_webview && g_webview) {
        char *escaped = escape_for_js(resp);
        size_t jslen = strlen(escaped) + 64;
        char *js = malloc(jslen);
        snprintf(js, jslen, "window.__butterReceive('%s')", escaped);
        webkit_web_view_run_javascript(g_webview, js, NULL, NULL, NULL);
        free(js);
        free(escaped);
    } else {
        ring_write_tb(resp, strlen(resp));
    }
}

static void handle_file_dialog_folder(const char *msg, int from_webview) {
    char msgId[64] = "0", title[256] = "Select Folder", prompt[256] = "";
    json_extract_string(msg, "id", msgId, sizeof(msgId));

    const char *data_start = strstr(msg, "\"data\":{");
    const char *search = data_start ? data_start : msg;

    json_extract_string(search, "title", title, sizeof(title));
    json_extract_string(search, "prompt", prompt, sizeof(prompt));

    GtkWidget *dlg = gtk_file_chooser_dialog_new(
        title, GTK_WINDOW(g_window), GTK_FILE_CHOOSER_ACTION_SELECT_FOLDER,
        "_Cancel", GTK_RESPONSE_CANCEL,
        strlen(prompt) > 0 ? prompt : "_Select", GTK_RESPONSE_ACCEPT,
        NULL);

    int result = gtk_dialog_run(GTK_DIALOG(dlg));
    char resp[4096];

    if (result == GTK_RESPONSE_ACCEPT) {
        char *folder = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dlg));
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"dialog:folder\",\"data\":{\"paths\":[\"%s\"],\"cancelled\":false}}",
            msgId, folder ? folder : "");
        g_free(folder);
    } else {
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"dialog:folder\",\"data\":{\"paths\":[],\"cancelled\":true}}",
            msgId);
    }

    gtk_widget_destroy(dlg);

    if (from_webview && g_webview) {
        char *escaped = escape_for_js(resp);
        size_t jslen = strlen(escaped) + 64;
        char *js = malloc(jslen);
        snprintf(js, jslen, "window.__butterReceive('%s')", escaped);
        webkit_web_view_run_javascript(g_webview, js, NULL, NULL, NULL);
        free(js);
        free(escaped);
    } else {
        ring_write_tb(resp, strlen(resp));
    }
}

/* ---------- system tray ---------- */

static void on_tray_menu_item_activate(GtkMenuItem *menuitem, gpointer user_data) {
    const char *action = (const char *)g_object_get_data(G_OBJECT(menuitem), "action");
    (void)user_data;
    if (!action) return;

    char json[512];
    snprintf(json, sizeof(json),
        "{\"id\":\"0\",\"type\":\"event\",\"action\":\"tray:action\",\"data\":{\"action\":\"%s\"}}",
        action);
    ring_write_tb(json, strlen(json));
}

static void handle_tray_set(const char *msg) {
    const char *data_start = strstr(msg, "\"data\":{");
    const char *search = data_start ? data_start : msg;

    char title[256] = "", tooltip[256] = "";
    json_extract_string(search, "title", title, sizeof(title));
    json_extract_string(search, "tooltip", tooltip, sizeof(tooltip));

    if (!g_tray_icon) {
        g_tray_icon = gtk_status_icon_new();
        gtk_status_icon_set_visible(g_tray_icon, TRUE);
    }

    if (strlen(title) > 0) {
        gtk_status_icon_set_title(g_tray_icon, title);
        /* Use title as fallback label since GtkStatusIcon has no text label */
        gtk_status_icon_set_from_icon_name(g_tray_icon, "application-x-executable");
    }

    if (strlen(tooltip) > 0) {
        gtk_status_icon_set_tooltip_text(g_tray_icon, tooltip);
    }

    /* Build menu from items array */
    const char *items_start = strstr(search, "\"items\":[");
    if (items_start) {
        if (g_tray_menu) gtk_widget_destroy(g_tray_menu);
        g_tray_menu = gtk_menu_new();

        const char *pos = items_start + 9;
        while (*pos != '\0' && *pos != ']') {
            /* Check for separator */
            const char *sep = strstr(pos, "\"separator\":");
            const char *next_obj = strchr(pos + 1, '{');
            const char *obj_end = strchr(pos, '}');

            if (sep && obj_end && sep < obj_end) {
                if (strstr(sep, "true") && strstr(sep, "true") < obj_end) {
                    GtkWidget *item = gtk_separator_menu_item_new();
                    gtk_menu_shell_append(GTK_MENU_SHELL(g_tray_menu), item);
                    pos = obj_end + 1;
                    continue;
                }
            }

            char label[128] = "", action[128] = "";
            if (json_extract_string(pos, "label", label, sizeof(label)) && strlen(label) > 0) {
                json_extract_string(pos, "action", action, sizeof(action));
                GtkWidget *item = gtk_menu_item_new_with_label(label);
                if (strlen(action) > 0) {
                    char *action_dup = strdup(action);
                    g_object_set_data_full(G_OBJECT(item), "action", action_dup, free);
                    g_signal_connect(item, "activate", G_CALLBACK(on_tray_menu_item_activate), NULL);
                }
                gtk_menu_shell_append(GTK_MENU_SHELL(g_tray_menu), item);
            }

            if (obj_end) pos = obj_end + 1;
            else break;
        }

        gtk_widget_show_all(g_tray_menu);
        gtk_status_icon_set_visible(g_tray_icon, TRUE);

        /* Connect popup menu signal */
        g_signal_handlers_disconnect_by_func(g_tray_icon,
            G_CALLBACK(gtk_menu_popup), NULL);
        g_signal_connect_swapped(g_tray_icon, "popup-menu",
            G_CALLBACK(gtk_menu_popup), g_tray_menu);
    }
}

static void handle_tray_remove(void) {
    if (g_tray_icon) {
        gtk_status_icon_set_visible(g_tray_icon, FALSE);
        g_object_unref(g_tray_icon);
        g_tray_icon = NULL;
    }
    if (g_tray_menu) {
        gtk_widget_destroy(g_tray_menu);
        g_tray_menu = NULL;
    }
}

/* ---------- global shortcuts (X11) ---------- */

static unsigned int parse_x11_modifiers(const char *json) {
    unsigned int mods = 0;
    /* Parse modifiers array from JSON */
    const char *arr = strstr(json, "\"modifiers\":[");
    if (!arr) return 0;
    arr += 13;
    while (*arr != ']' && *arr != '\0') {
        if (strncmp(arr, "\"ctrl\"", 6) == 0) mods |= ControlMask;
        else if (strncmp(arr, "\"alt\"", 5) == 0) mods |= Mod1Mask;
        else if (strncmp(arr, "\"shift\"", 7) == 0) mods |= ShiftMask;
        else if (strncmp(arr, "\"super\"", 7) == 0 || strncmp(arr, "\"cmd\"", 5) == 0) mods |= Mod4Mask;
        arr++;
    }
    return mods;
}

static KeyCode keysym_for_name(Display *dpy, const char *keyname) {
    /* Map common key names to X11 keysyms */
    KeySym sym = 0;
    if (strlen(keyname) == 1) {
        /* Single character key */
        sym = XStringToKeysym(keyname);
        if (sym == NoSymbol) {
            char upper[2] = { (char)toupper((unsigned char)keyname[0]), '\0' };
            sym = XStringToKeysym(upper);
        }
    } else if (strcasecmp(keyname, "space") == 0) sym = XK_space;
    else if (strcasecmp(keyname, "return") == 0 || strcasecmp(keyname, "enter") == 0) sym = XK_Return;
    else if (strcasecmp(keyname, "tab") == 0) sym = XK_Tab;
    else if (strcasecmp(keyname, "escape") == 0 || strcasecmp(keyname, "esc") == 0) sym = XK_Escape;
    else if (strcasecmp(keyname, "delete") == 0 || strcasecmp(keyname, "backspace") == 0) sym = XK_BackSpace;
    else if (strcasecmp(keyname, "up") == 0) sym = XK_Up;
    else if (strcasecmp(keyname, "down") == 0) sym = XK_Down;
    else if (strcasecmp(keyname, "left") == 0) sym = XK_Left;
    else if (strcasecmp(keyname, "right") == 0) sym = XK_Right;
    else if (strcasecmp(keyname, "f1") == 0) sym = XK_F1;
    else if (strcasecmp(keyname, "f2") == 0) sym = XK_F2;
    else if (strcasecmp(keyname, "f3") == 0) sym = XK_F3;
    else if (strcasecmp(keyname, "f4") == 0) sym = XK_F4;
    else if (strcasecmp(keyname, "f5") == 0) sym = XK_F5;
    else if (strcasecmp(keyname, "f6") == 0) sym = XK_F6;
    else if (strcasecmp(keyname, "f7") == 0) sym = XK_F7;
    else if (strcasecmp(keyname, "f8") == 0) sym = XK_F8;
    else if (strcasecmp(keyname, "f9") == 0) sym = XK_F9;
    else if (strcasecmp(keyname, "f10") == 0) sym = XK_F10;
    else if (strcasecmp(keyname, "f11") == 0) sym = XK_F11;
    else if (strcasecmp(keyname, "f12") == 0) sym = XK_F12;
    else {
        sym = XStringToKeysym(keyname);
    }
    if (sym == NoSymbol) return 0;
    return XKeysymToKeycode(dpy, sym);
}

static void handle_shortcut_register(const char *msg) {
    if (g_shortcut_count >= MAX_SHORTCUTS) return;

    const char *data_start = strstr(msg, "\"data\":{");
    const char *search = data_start ? data_start : msg;

    char shortcutId[64] = "", keyname[64] = "";
    json_extract_string(search, "id", shortcutId, sizeof(shortcutId));

    /* Find the "shortcut" object to get "key" */
    const char *sc = strstr(search, "\"shortcut\":{");
    if (!sc) return;
    json_extract_string(sc, "key", keyname, sizeof(keyname));
    if (strlen(keyname) == 0) return;

    unsigned int mods = parse_x11_modifiers(sc);

    GdkDisplay *gdkdpy = gdk_display_get_default();
    Display *dpy = GDK_DISPLAY_XDISPLAY(gdkdpy);
    Window root = DefaultRootWindow(dpy);

    KeyCode kc = keysym_for_name(dpy, keyname);
    if (kc == 0) return;

    /* Grab the key on root window */
    XGrabKey(dpy, kc, mods, root, False, GrabModeAsync, GrabModeAsync);
    /* Also grab with NumLock and CapsLock variants */
    XGrabKey(dpy, kc, mods | Mod2Mask, root, False, GrabModeAsync, GrabModeAsync);
    XGrabKey(dpy, kc, mods | LockMask, root, False, GrabModeAsync, GrabModeAsync);
    XGrabKey(dpy, kc, mods | Mod2Mask | LockMask, root, False, GrabModeAsync, GrabModeAsync);

    RegisteredShortcut *s = &g_shortcuts[g_shortcut_count++];
    strncpy(s->id, shortcutId, sizeof(s->id) - 1);
    s->id[sizeof(s->id) - 1] = '\0';
    s->modifiers = mods;
    s->keycode = kc;
}

static void handle_shortcut_unregister(const char *msg) {
    const char *data_start = strstr(msg, "\"data\":{");
    const char *search = data_start ? data_start : msg;

    char shortcutId[64] = "";
    json_extract_string(search, "id", shortcutId, sizeof(shortcutId));
    if (strlen(shortcutId) == 0) return;

    GdkDisplay *gdkdpy = gdk_display_get_default();
    Display *dpy = GDK_DISPLAY_XDISPLAY(gdkdpy);
    Window root = DefaultRootWindow(dpy);

    for (int i = 0; i < g_shortcut_count; i++) {
        if (strcmp(g_shortcuts[i].id, shortcutId) == 0) {
            XUngrabKey(dpy, g_shortcuts[i].keycode, g_shortcuts[i].modifiers, root);
            XUngrabKey(dpy, g_shortcuts[i].keycode, g_shortcuts[i].modifiers | Mod2Mask, root);
            XUngrabKey(dpy, g_shortcuts[i].keycode, g_shortcuts[i].modifiers | LockMask, root);
            XUngrabKey(dpy, g_shortcuts[i].keycode, g_shortcuts[i].modifiers | Mod2Mask | LockMask, root);
            memmove(&g_shortcuts[i], &g_shortcuts[i + 1],
                (g_shortcut_count - i - 1) * sizeof(RegisteredShortcut));
            g_shortcut_count--;
            break;
        }
    }
}

static GdkFilterReturn shortcut_x11_filter(GdkXEvent *xevent, GdkEvent *event, gpointer data) {
    (void)event;
    (void)data;
    XEvent *xev = (XEvent *)xevent;
    if (xev->type != KeyPress) return GDK_FILTER_CONTINUE;

    XKeyEvent *kev = &xev->xkey;
    /* Mask out NumLock and CapsLock for comparison */
    unsigned int clean_state = kev->state & ~(Mod2Mask | LockMask);

    for (int i = 0; i < g_shortcut_count; i++) {
        if (g_shortcuts[i].keycode == kev->keycode &&
            g_shortcuts[i].modifiers == clean_state) {
            char json[256];
            snprintf(json, sizeof(json),
                "{\"id\":\"0\",\"type\":\"event\",\"action\":\"shortcut:triggered\",\"data\":{\"id\":\"%s\"}}",
                g_shortcuts[i].id);
            ring_write_tb(json, strlen(json));
            return GDK_FILTER_REMOVE;
        }
    }
    return GDK_FILTER_CONTINUE;
}

/* ---------- screen capture ---------- */

static void handle_window_screenshot(const char *msg) {
    char msgId[64] = "0", savePath[1024] = "";
    json_extract_string(msg, "id", msgId, sizeof(msgId));

    const char *data_start = strstr(msg, "\"data\":{");
    const char *search = data_start ? data_start : msg;
    json_extract_string(search, "path", savePath, sizeof(savePath));

    if (!g_webview || strlen(savePath) == 0) {
        char resp[256];
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"window:screenshot\",\"data\":{\"ok\":false}}",
            msgId);
        ring_write_tb(resp, strlen(resp));
        return;
    }

    GtkWidget *widget = GTK_WIDGET(g_webview);
    GtkAllocation alloc;
    gtk_widget_get_allocation(widget, &alloc);

    cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, alloc.width, alloc.height);
    cairo_t *cr = cairo_create(surface);
    gtk_widget_draw(widget, cr);
    cairo_destroy(cr);

    cairo_status_t status = cairo_surface_write_to_png(surface, savePath);
    cairo_surface_destroy(surface);

    char resp[1024];
    if (status == CAIRO_STATUS_SUCCESS) {
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"window:screenshot\",\"data\":{\"ok\":true,\"path\":\"%s\"}}",
            msgId, savePath);
    } else {
        snprintf(resp, sizeof(resp),
            "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"window:screenshot\",\"data\":{\"ok\":false}}",
            msgId);
    }
    ring_write_tb(resp, strlen(resp));
}

/* ---------- screen/monitor info ---------- */

static void handle_screen_list(const char *msg) {
    char msgId[64] = "0";
    json_extract_string(msg, "id", msgId, sizeof(msgId));

    GdkDisplay *display = gdk_display_get_default();
    int n_monitors = gdk_display_get_n_monitors(display);

    char resp[8192];
    size_t off = 0;
    off += (size_t)snprintf(resp + off, sizeof(resp) - off,
        "{\"id\":\"%s\",\"type\":\"response\",\"action\":\"screen:list\",\"data\":[", msgId);

    for (int i = 0; i < n_monitors; i++) {
        GdkMonitor *monitor = gdk_display_get_monitor(display, i);
        GdkRectangle geom, workarea;
        gdk_monitor_get_geometry(monitor, &geom);
        gdk_monitor_get_workarea(monitor, &workarea);
        int scale = gdk_monitor_get_scale_factor(monitor);
        int is_primary = (monitor == gdk_display_get_primary_monitor(display)) ? 1 : 0;

        if (i > 0) off += (size_t)snprintf(resp + off, sizeof(resp) - off, ",");
        off += (size_t)snprintf(resp + off, sizeof(resp) - off,
            "{\"x\":%d,\"y\":%d,\"width\":%d,\"height\":%d,"
            "\"visibleX\":%d,\"visibleY\":%d,\"visibleWidth\":%d,\"visibleHeight\":%d,"
            "\"scaleFactor\":%d,\"isPrimary\":%s}",
            geom.x, geom.y, geom.width, geom.height,
            workarea.x, workarea.y, workarea.width, workarea.height,
            scale, is_primary ? "true" : "false");
    }

    off += (size_t)snprintf(resp + off, sizeof(resp) - off, "]}");
    ring_write_tb(resp, strlen(resp));
}

/* ---------- power/sleep/wake via logind ---------- */

static void on_logind_prepare_for_sleep(GDBusConnection *conn, const gchar *sender,
                                         const gchar *object_path, const gchar *interface_name,
                                         const gchar *signal_name, GVariant *parameters,
                                         gpointer user_data) {
    (void)conn; (void)sender; (void)object_path;
    (void)interface_name; (void)signal_name; (void)user_data;

    gboolean sleeping = FALSE;
    g_variant_get(parameters, "(b)", &sleeping);

    if (sleeping) {
        const char *json = "{\"id\":\"0\",\"type\":\"event\",\"action\":\"power:sleep\"}";
        ring_write_tb(json, strlen(json));
    } else {
        const char *json = "{\"id\":\"0\",\"type\":\"event\",\"action\":\"power:wake\"}";
        ring_write_tb(json, strlen(json));
    }
}

static void setup_logind_power_monitor(void) {
    GError *err = NULL;
    g_logind_conn = g_bus_get_sync(G_BUS_TYPE_SYSTEM, NULL, &err);
    if (!g_logind_conn) {
        if (err) {
            fprintf(stderr, "[shim] failed to connect to system bus: %s\n", err->message);
            g_error_free(err);
        }
        return;
    }

    g_logind_signal_id = g_dbus_connection_signal_subscribe(
        g_logind_conn,
        "org.freedesktop.login1",
        "org.freedesktop.login1.Manager",
        "PrepareForSleep",
        "/org/freedesktop/login1",
        NULL,
        G_DBUS_SIGNAL_FLAGS_NONE,
        on_logind_prepare_for_sleep,
        NULL, NULL);
}

/* ---------- deep linking ---------- */

static void check_deep_link_argv(int argc, char **argv) {
    /* Check for URL arguments like myapp://something */
    for (int i = 1; i < argc; i++) {
        if (strstr(argv[i], "://") && argv[i][0] != '/') {
            g_deep_link_url = strdup(argv[i]);
            break;
        }
    }
}

static void emit_deep_link_event(void) {
    if (!g_deep_link_url) return;

    char json[2048];
    snprintf(json, sizeof(json),
        "{\"id\":\"0\",\"type\":\"event\",\"action\":\"app:openurl\",\"data\":{\"url\":\"%s\"}}",
        g_deep_link_url);
    ring_write_tb(json, strlen(json));

    free(g_deep_link_url);
    g_deep_link_url = NULL;
}

/* ---------- poll timer (to-shim ring buffer) ---------- */

static gboolean poll_timer(gpointer user_data) {
    (void)user_data;

    char *msg;
    while ((msg = ring_read_ts()) != NULL) {
        if (strstr(msg, "\"type\":\"control\"")) {
            if (strstr(msg, "\"quit\"")) {
                free(msg);
                gtk_main_quit();
                return G_SOURCE_REMOVE;
            }
            if (strstr(msg, "\"reload\"")) {
                free(msg);
                if (g_webview)
                    webkit_web_view_reload(g_webview);
                continue;
            }
            if (strstr(msg, "\"window:print\"")) {
                if (g_webview) {
                    webkit_web_view_run_javascript(g_webview, "window.print()", NULL, NULL, NULL);
                }
                free(msg);
                continue;
            }
            if (strstr(msg, "\"menu:set\"")) {
                /* GTK doesn't have a standard app menu bar — skip for now */
                free(msg);
                continue;
            }
            if (strstr(msg, "\"dialog:message\"")) {
                handle_message_dialog(msg, 0);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"dialog:open\"")) {
                handle_file_dialog_open(msg, 0);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"dialog:save\"")) {
                handle_file_dialog_save(msg, 0);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"dialog:folder\"")) {
                handle_file_dialog_folder(msg, 0);
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
            if (strstr(msg, "\"shortcut:register\"")) {
                handle_shortcut_register(msg);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"shortcut:unregister\"")) {
                handle_shortcut_unregister(msg);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:screenshot\"")) {
                handle_window_screenshot(msg);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"screen:list\"")) {
                handle_screen_list(msg);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:create\"")) {
                handle_window_create(msg);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:set\"")) {
                handle_window_set(msg);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:maximize\"")) {
                gtk_window_maximize(GTK_WINDOW(g_window));
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:minimize\"")) {
                gtk_window_iconify(GTK_WINDOW(g_window));
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:restore\"")) {
                gtk_window_deiconify(GTK_WINDOW(g_window));
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:fullscreen\"")) {
                if (strstr(msg, "\"enable\":true"))
                    gtk_window_fullscreen(GTK_WINDOW(g_window));
                else
                    gtk_window_unfullscreen(GTK_WINDOW(g_window));
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:alwaysontop\"")) {
                int enable = json_extract_bool(msg, "enable", 0);
                gtk_window_set_keep_above(GTK_WINDOW(g_window), enable);
                free(msg);
                continue;
            }
            if (strstr(msg, "\"window:close\"")) {
                char wid[64];
                if (json_extract_string(msg, "windowId", wid, sizeof(wid))) {
                    for (int i = 0; i < g_window_count; i++) {
                        if (strcmp(g_windows[i].id, wid) == 0) {
                            gtk_widget_destroy(g_windows[i].window);
                            memmove(&g_windows[i], &g_windows[i+1], (g_window_count - i - 1) * sizeof(ButterWindow));
                            g_window_count--;
                            break;
                        }
                    }
                }
                free(msg);
                continue;
            }
        }

        /* inject response/event into webview */
        if (g_webview) {
            char *escaped = escape_for_js(msg);
            size_t jslen = strlen(escaped) + 64;
            char *js = malloc(jslen);
            snprintf(js, jslen, "window.__butterReceive('%s')", escaped);
            webkit_web_view_run_javascript(g_webview, js, NULL, NULL, NULL);
            free(js);
            free(escaped);
        }
        free(msg);
    }

    return G_SOURCE_CONTINUE;
}

/* ---------- window close handler ---------- */

static gboolean on_window_close(GtkWidget *widget, GdkEvent *event, gpointer data) {
    (void)widget;
    (void)event;
    (void)data;

    const char *quit = "{\"id\":\"0\",\"type\":\"control\",\"action\":\"quit\"}";
    ring_write_tb(quit, strlen(quit));
    gtk_main_quit();
    return FALSE;
}

/* ---------- open shared memory ---------- */

static int open_shm(const char *name) {
    int fd = shm_open(name, O_RDWR, 0600);
    if (fd < 0) { perror("shm_open"); return -1; }

    g_shm = mmap(NULL, SHM_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (g_shm == MAP_FAILED) { perror("mmap"); g_shm = NULL; return -1; }

    size_t nlen = strlen(name);
    char stb[nlen + 4];
    char sts[nlen + 4];
    snprintf(stb, sizeof(stb), "%s.tb", name);
    snprintf(sts, sizeof(sts), "%s.ts", name);

    g_sem_tb = sem_open(stb, 0);
    g_sem_ts = sem_open(sts, 0);
    if (g_sem_tb == SEM_FAILED || g_sem_ts == SEM_FAILED) {
        fprintf(stderr, "sem_open failed\n");
        return -1;
    }
    return 0;
}

/* ---------- main ---------- */

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: %s <shm-name> <html-path>\n", argv[0]);
        return 1;
    }

    const char *shm_name  = argv[1];
    const char *html_path = argv[2];
    const char *title     = getenv("BUTTER_TITLE");
    if (!title) title = "Butter App";

    /* Check for deep link URL in argv before consuming args */
    check_deep_link_argv(argc, argv);

    if (open_shm(shm_name) != 0) return 1;

    gtk_init(&argc, &argv);

    /* Install X11 event filter for global shortcuts */
    gdk_window_add_filter(NULL, shortcut_x11_filter, NULL);

    /* Setup logind power/sleep monitoring */
    setup_logind_power_monitor();

    /* window */
    g_window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(g_window), title);
    gtk_window_set_default_size(GTK_WINDOW(g_window), 1024, 768);
    g_signal_connect(g_window, "delete-event", G_CALLBACK(on_window_close), NULL);

    /* webview with user content manager */
    WebKitUserContentManager *ucm = webkit_user_content_manager_new();

    /* inject bridge JS at document start */
    WebKitUserScript *script = webkit_user_script_new(
        BRIDGE_JS,
        WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES,
        WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
        NULL, NULL);
    webkit_user_content_manager_add_script(ucm, script);
    webkit_user_script_unref(script);

    /* register script message handler */
    g_signal_connect(ucm, "script-message-received::butter",
                     G_CALLBACK(on_script_message), NULL);
    webkit_user_content_manager_register_script_message_handler(ucm, "butter");

    /* create webview */
    g_webview = WEBKIT_WEB_VIEW(webkit_web_view_new_with_user_content_manager(ucm));
    gtk_container_add(GTK_CONTAINER(g_window), GTK_WIDGET(g_webview));

    /* load HTML file */
    char *uri = g_filename_to_uri(html_path, NULL, NULL);
    if (uri) {
        webkit_web_view_load_uri(g_webview, uri);
        g_free(uri);
    } else {
        /* fallback: construct file:// URI manually */
        char *abs = realpath(html_path, NULL);
        if (abs) {
            size_t ulen = strlen(abs) + 8;
            char *furi = malloc(ulen);
            snprintf(furi, ulen, "file://%s", abs);
            webkit_web_view_load_uri(g_webview, furi);
            free(furi);
            free(abs);
        } else {
            fprintf(stderr, "[shim] failed to resolve html path: %s\n", html_path);
            return 1;
        }
    }

    /* poll timer ~60fps (16ms) */
    g_timeout_add(16, poll_timer, NULL);

    /* Emit deep link event if URL was passed on command line */
    if (g_deep_link_url) {
        emit_deep_link_event();
    }

    /* show and run */
    gtk_widget_show_all(g_window);
    gtk_main();

    /* cleanup */
    gdk_window_remove_filter(NULL, shortcut_x11_filter, NULL);

    /* Ungrab all global shortcuts */
    if (g_shortcut_count > 0) {
        GdkDisplay *gdkdpy = gdk_display_get_default();
        if (gdkdpy) {
            Display *dpy = GDK_DISPLAY_XDISPLAY(gdkdpy);
            Window root = DefaultRootWindow(dpy);
            for (int i = 0; i < g_shortcut_count; i++) {
                XUngrabKey(dpy, g_shortcuts[i].keycode, g_shortcuts[i].modifiers, root);
                XUngrabKey(dpy, g_shortcuts[i].keycode, g_shortcuts[i].modifiers | Mod2Mask, root);
                XUngrabKey(dpy, g_shortcuts[i].keycode, g_shortcuts[i].modifiers | LockMask, root);
                XUngrabKey(dpy, g_shortcuts[i].keycode, g_shortcuts[i].modifiers | Mod2Mask | LockMask, root);
            }
        }
        g_shortcut_count = 0;
    }

    handle_tray_remove();

    if (g_logind_signal_id && g_logind_conn) {
        g_dbus_connection_signal_unsubscribe(g_logind_conn, g_logind_signal_id);
    }
    if (g_logind_conn) {
        g_object_unref(g_logind_conn);
    }

    if (g_deep_link_url) free(g_deep_link_url);

    if (g_shm) munmap(g_shm, SHM_SIZE);
    if (g_sem_tb && g_sem_tb != SEM_FAILED) sem_close(g_sem_tb);
    if (g_sem_ts && g_sem_ts != SEM_FAILED) sem_close(g_sem_ts);

    return 0;
}

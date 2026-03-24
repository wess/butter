/*
 * Butter shim — Linux native window with GTK3 + WebKitGTK
 * Pure C for GTK/WebKit integration
 *
 * Usage: ./shim <shm-name> <html-path>
 * Env:   BUTTER_TITLE — window title (default: "Butter App")
 *        BUTTER_MENU  — JSON menu definition (optional, skipped in v0.1)
 *
 * Compile: cc -o shim linux.c $(pkg-config --cflags --libs gtk+-3.0 webkit2gtk-4.1)
 */

#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <sys/mman.h>
#include <fcntl.h>
#include <semaphore.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <unistd.h>

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
      "if(m.type==='response'){"
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
      "on:function(a,h){if(!l.has(a))l.set(a,[]);l.get(a).push(h);}"
    "};"
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
        ring_write_tb(str, strlen(str));
        g_free(str);
    }
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

    if (open_shm(shm_name) != 0) return 1;

    gtk_init(&argc, &argv);

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

    /* show and run */
    gtk_widget_show_all(g_window);
    gtk_main();

    /* cleanup */
    if (g_shm) munmap(g_shm, SHM_SIZE);
    if (g_sem_tb && g_sem_tb != SEM_FAILED) sem_close(g_sem_tb);
    if (g_sem_ts && g_sem_ts != SEM_FAILED) sem_close(g_sem_ts);

    return 0;
}

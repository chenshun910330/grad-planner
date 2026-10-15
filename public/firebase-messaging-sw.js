// 研途手帳的 Service Worker：
// 1. 離線快取 app 外框（沒網路也打得開）
// 2. 接收 Firebase Cloud Messaging 背景推播（app 沒開時跳通知）
importScripts('./firebase-config.js');

const CACHE_NAME = 'grad-planner-shell-v1';
const SHELL_FILES = ['./', './index.html', './manifest.json', './firebase-config.js', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

// 只處理同網域與 Firebase SDK / 字型的 GET；Firestore 的連線不能攔
const CACHEABLE = url => url.origin === self.location.origin ||
  url.hostname === 'www.gstatic.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!CACHEABLE(url) || url.pathname.startsWith('/__/')) return;
  event.respondWith(
    fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});

// 點通知 → 打開或切回 app（Firebase 自己顯示的通知由 SDK 處理）
self.addEventListener('notificationclick', event => {
  if (event.notification.data && event.notification.data.FCM_MSG) return;
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow('./');
  }));
});

const cfg = self.FIREBASE_CONFIG || {};
if (cfg.apiKey && !String(cfg.apiKey).startsWith('PASTE')) {
  importScripts(
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js'
  );
  firebase.initializeApp(cfg);
  // 推播內容帶 notification 欄位，SDK 會自動在背景顯示，這裡不用再自己 showNotification
  firebase.messaging();
}

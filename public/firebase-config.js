// Firebase 設定值：建好 Firebase 專案後，把主控台「專案設定 → 你的應用程式」裡的值貼到這裡。
// 頁面（index.html）和背景推播（firebase-messaging-sw.js）都讀這一份。
// apiKey 還是 PASTE_ 開頭時，app 會進入「試用模式」：資料只存在這台裝置、不會推播。
self.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCoV8wvOrX6bTj1vp1DV-RWlff8L4PmIYU",
  authDomain: "grad-planner-1016.web.app",
  projectId: "grad-planner-1016",
  storageBucket: "grad-planner-1016.firebasestorage.app",
  messagingSenderId: "345056890573",
  appId: "1:345056890573:web:ff09c30b7b7964e2096384"
};

// Cloud Messaging → 網路設定 → Web Push 憑證 → 金鑰組
self.VAPID_KEY = "BOWvLyXJ0HmsAfJsFd6mO3K4W9e4zmzwYmmawflBG7KgVPG6QH8lRwzDMfAp3sTJJmbEv2Z3ZlJP0pNQAbhxHj4";

// 本機測試時改成 true，會連到 Firebase 模擬器而不是正式資料庫
self.USE_EMULATORS = false;

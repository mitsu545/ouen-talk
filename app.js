"use strict";

// ===== 状態管理 =====
var STORAGE_KEY = "ouen_talk_v1"; // v1のデータをそのまま引き継ぐ
var GROUP_ID = "g1";
var PROACTIVE_HOURS = 6; // ① この時間以上空いたら向こうからメッセージが届く

var DEFAULT_STATE = {
  apiKey: "",
  model: "gemini-2.5-flash",
  lastOpen: 0,
  unread: { c1: 0, c2: 0, c3: 0, g1: 0 },
  chars: [
    { id: "c1", name: "ひなた", icon: "", persona: "元気いっぱいの後輩キャラ。明るく全力で応援する。語尾は「っす！」。絵文字を少し使う。" },
    { id: "c2", name: "澪",     icon: "", persona: "落ち着いたお姉さんキャラ。静かに寄り添い、頑張りを認めてくれる。丁寧で優しい口調。" },
    { id: "c3", name: "剛田コーチ", icon: "", persona: "熱血コーチキャラ。喝と激励で背中を押す。「よし、いくぞ！」が口癖。男らしい口調。" }
  ],
  histories: { c1: [], c2: [], c3: [], g1: [] }
};

var state = loadState();
var currentRoomId = null;
var apiBusy = false; // 通信中は次の送信をブロック（429対策の本丸）

function loadState() {
  var s = JSON.parse(JSON.stringify(DEFAULT_STATE));
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      var saved = JSON.parse(raw);
      // v1データにv2の項目（グループ・未読）を足す引き継ぎ処理
      for (var k in saved) { s[k] = saved[k]; }
      if (!s.histories[GROUP_ID]) { s.histories[GROUP_ID] = []; }
      if (!s.unread) { s.unread = { c1: 0, c2: 0, c3: 0, g1: 0 }; }
      if (!s.lastOpen) { s.lastOpen = 0; }
    }
  } catch (e) { console.error("load error", e); }
  return s;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    alert("保存に失敗しました。アイコン画像が大きすぎる可能性があります。");
  }
}

// ===== ユーティリティ =====
function $(id) { return document.getElementById(id); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function getChar(id) {
  for (var i = 0; i < state.chars.length; i++) {
    if (state.chars[i].id === id) { return state.chars[i]; }
  }
  return null;
}

function findCharByName(name) {
  for (var i = 0; i < state.chars.length; i++) {
    if (name.indexOf(state.chars[i].name) !== -1) { return state.chars[i]; }
  }
  return null;
}

function iconHtml(ch, sizeClass) {
  if (ch && ch.icon) {
    return '<img src="' + ch.icon + '" class="' + sizeClass + ' rounded-full object-cover" alt="">';
  }
  if (!ch) { // グループ用アイコン
    return '<div class="' + sizeClass + ' rounded-full bg-[#06c755] flex items-center justify-center text-white">👥</div>';
  }
  return '<div class="' + sizeClass + ' rounded-full bg-gray-300 flex items-center justify-center font-bold text-white">' +
    escapeHtml(ch.name.charAt(0)) + '</div>';
}

function roomName(id) {
  if (id === GROUP_ID) { return "みんな（" + state.chars.length + "）"; }
  var ch = getChar(id);
  return ch ? ch.name : "";
}

// ===== 画面切り替え =====
function showScreen(name) {
  var screens = document.querySelectorAll(".screen");
  for (var i = 0; i < screens.length; i++) { screens[i].classList.remove("active"); }
  $("screen-" + name).classList.add("active");
}

// ===== ホーム画面 =====
function renderHome() {
  var roomIds = [GROUP_ID, "c1", "c2", "c3"];
  var html = "";
  for (var i = 0; i < roomIds.length; i++) {
    var id = roomIds[i];
    var ch = getChar(id); // グループはnull
    var hist = state.histories[id] || [];
    var last = hist.length ? hist[hist.length - 1].text : "タップして話しかけよう";
    if (last.length > 25) { last = last.slice(0, 25) + "…"; }
    var badge = "";
    if (state.unread[id] > 0) { // ① 未読バッジ
      badge = '<span class="ml-auto shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-[#06c755] text-white text-xs flex items-center justify-center">' +
        state.unread[id] + '</span>';
    }
    html += '<button class="room-item w-full flex items-center gap-3 px-4 py-3 border-b border-gray-100 active:bg-gray-100 text-left" data-id="' + id + '">' +
      iconHtml(ch, "w-12 h-12 shrink-0") +
      '<div class="min-w-0 flex-1"><div class="font-bold">' + escapeHtml(roomName(id)) + '</div>' +
      '<div class="text-sm text-gray-500 truncate">' + escapeHtml(last) + '</div></div>' +
      badge + '</button>';
  }
  $("room-list").innerHTML = html;
  var items = document.querySelectorAll(".room-item");
  for (var j = 0; j < items.length; j++) {
    items[j].addEventListener("click", function () { openChat(this.getAttribute("data-id")); });
  }
}

// ===== トーク画面 =====
function openChat(id) {
  currentRoomId = id;
  state.unread[id] = 0; // 開いたら未読を消す
  saveState();
  $("chat-title").textContent = roomName(id);
  renderMessages();
  showScreen("chat");
}

function renderMessages() {
  var isGroup = currentRoomId === GROUP_ID;
  var hist = state.histories[currentRoomId] || [];
  var html = "";
  for (var i = 0; i < hist.length; i++) {
    var m = hist[i];
    if (m.role === "user") {
      html += '<div class="flex justify-end"><div class="bubble-user max-w-[75%] px-4 py-2 text-[15px] whitespace-pre-wrap break-words">' +
        escapeHtml(m.text) + '</div></div>';
    } else {
      var ch = getChar(m.charId || currentRoomId);
      var nameLabel = "";
      if (isGroup && ch) { // ② グループでは発言者名を表示（LINEと同じ）
        nameLabel = '<div class="text-xs text-white/90 mb-1 ml-1">' + escapeHtml(ch.name) + '</div>';
      }
      html += '<div class="flex items-end gap-2">' + iconHtml(ch, "w-8 h-8 shrink-0") +
        '<div class="max-w-[75%]">' + nameLabel +
        '<div class="bubble-ai px-4 py-2 text-[15px] whitespace-pre-wrap break-words">' +
        escapeHtml(m.text) + '</div></div></div>';
    }
  }
  $("messages").innerHTML = html;
  $("messages").scrollTop = $("messages").scrollHeight;
}

function showTyping() {
  var el = document.createElement("div");
  el.id = "typing";
  el.className = "flex items-end gap-2";
  el.innerHTML = '<div class="w-8 h-8 shrink-0"></div>' +
    '<div class="bubble-ai px-4 py-3 flex gap-1"><span class="typing-dot">●</span><span class="typing-dot">●</span><span class="typing-dot">●</span></div>';
  $("messages").appendChild(el);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function hideTyping() {
  var el = $("typing");
  if (el) { el.remove(); }
}

// ===== 送信処理 =====
function sendText(text) {
  if (!text) { return; }
  if (!state.apiKey) {
    alert("設定画面でGemini APIキーを入力してください");
    showScreen("settings");
    return;
  }
  if (apiBusy) { return; } // ①自動メッセージ等と重ならないようにブロック
  apiBusy = true;
  $("btn-send").disabled = true;
  var hist = state.histories[currentRoomId];
  hist.push({ role: "user", text: text, t: Date.now() });
  saveState();
  renderMessages();
  showTyping();
  var call = currentRoomId === GROUP_ID ? callGeminiGroup() : callGeminiSolo(currentRoomId);
  call.then(function (msgs) {
    hideTyping();
    apiBusy = false;
    $("btn-send").disabled = false;
    addAiMessages(currentRoomId, msgs, 0, false);
  }).catch(function (err) {
    hideTyping();
    apiBusy = false;
    $("btn-send").disabled = false;
    hist.push({ role: "ai", charId: currentRoomId === GROUP_ID ? "c1" : currentRoomId, text: "（エラー：" + err.message + "）", t: Date.now() });
    saveState();
    renderMessages();
  });
}

function sendMessage() {
  var text = $("input").value.trim();
  $("input").value = "";
  sendText(text);
}

// msgs = [{charId, text}] を0.6秒間隔でポンポン表示
function addAiMessages(roomId, msgs, idx, asUnread) {
  if (idx >= msgs.length) { renderHome(); return; }
  state.histories[roomId].push({ role: "ai", charId: msgs[idx].charId, text: msgs[idx].text, t: Date.now() });
  if (asUnread) { state.unread[roomId] = (state.unread[roomId] || 0) + 1; }
  saveState();
  if (currentRoomId === roomId) { renderMessages(); }
  setTimeout(function () { addAiMessages(roomId, msgs, idx + 1, asUnread); }, 600);
}

// ===== Gemini API 共通 =====
function geminiFetch(systemText, contents, maxTokens) {
  var url = "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(state.model) + ":generateContent?key=" + encodeURIComponent(state.apiKey);
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents: contents,
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: maxTokens,
        thinkingConfig: { thinkingBudget: 0 } // 内部思考を止め、返答本体にトークンを使わせる（空返信・オウム返し対策）
      }
    })
  }).then(function (res) {
    if (!res.ok) { throw new Error("API " + res.status); }
    return res.json();
  }).then(function (data) {
    try { return data.candidates[0].content.parts[0].text; }
    catch (e) { throw new Error("応答の形式が想定外でした"); }
  });
}

function historyToContents(roomId) {
  var recent = (state.histories[roomId] || []).slice(-20);
  var contents = [];
  for (var i = 0; i < recent.length; i++) {
    var m = recent[i];
    var text = m.text;
    if (m.role !== "user" && roomId === GROUP_ID) {
      var ch = getChar(m.charId);
      if (ch) { text = ch.name + ": " + text; } // グループでは誰の発言か明記
    }
    contents.push({ role: m.role === "user" ? "user" : "model", parts: [{ text: text }] });
  }
  return contents;
}

// 1人トーク用
function callGeminiSolo(charId) {
  var ch = getChar(charId);
  var sys = "あなたは「" + ch.name + "」というキャラクターです。以下の性格・口調設定を、" +
    "どんな内容の返答でも一言一句まで必ず守ってください（設定を無視した一般的な返答は禁止）：\n" +
    "【" + ch.name + "の設定】" + ch.persona + "\n" +
    "ユーザー（おみつ）を応援するのが役目です。" +
    " ユーザーの発言をただ聞き返すだけの返答は禁止です。必ず中身のある反応（励まし・労い・具体的な一言アドバイスなど）をしてください。" +
    " 返答はLINEのトークのように短文で、1〜3個のメッセージに分けてください。" +
    " メッセージの区切りには ||| を使ってください。1メッセージは60文字以内。";
  return geminiFetch(sys, historyToContents(charId), 400).then(function (text) {
    var out = [];
    var parts = text.split("|||");
    for (var i = 0; i < parts.length && out.length < 3; i++) {
      var t = parts[i].trim();
      if (t) { out.push({ charId: charId, text: t }); }
    }
    return out.length ? out : [{ charId: charId, text: "……（返事が空でした）" }];
  });
}

// ② グループトーク用：1回のAPI呼び出しで3人分の掛け合いを生成
function callGeminiGroup() {
  var personaList = "";
  for (var i = 0; i < state.chars.length; i++) {
    var c = state.chars[i];
    personaList += "・" + c.name + "：" + c.persona + "\n";
  }
  var sys = "あなたはLINEグループの3人のキャラクターを同時に演じます。各キャラの性格・口調は" +
    "下記設定を一言一句まで必ず守り、絶対に混同・一般化しないでください：\n" + personaList +
    "ユーザー（おみつ）を応援するグループです。3人がキャラらしく掛け合いながら反応してください。" +
    " ユーザーの発言をただ聞き返すだけの返答は禁止です。必ず中身のある反応をしてください。" +
    " 2〜4個のメッセージを出力し、区切りには ||| を使ってください。" +
    " 各メッセージは必ず「名前: 本文」の形式で、本文は60文字以内。同じ人が連続してもOKですが最低2人は登場させてください。";
  return geminiFetch(sys, historyToContents(GROUP_ID), 700).then(function (text) {
    var out = [];
    var parts = text.split("|||");
    for (var i = 0; i < parts.length && out.length < 4; i++) {
      var t = parts[i].trim();
      if (!t) { continue; }
      var m = t.match(/^(.+?)[:：]\s*([\s\S]+)$/);
      var ch = m ? findCharByName(m[1]) : null;
      out.push({ charId: ch ? ch.id : state.chars[0].id, text: m ? m[2].trim() : t });
    }
    return out.length ? out : [{ charId: state.chars[0].id, text: "……（返事が空でした）" }];
  });
}

// ===== ① 勝手に届いてる演出 =====
function checkProactive() {
  var now = Date.now();
  var elapsed = now - (state.lastOpen || 0);
  state.lastOpen = now;
  saveState();
  if (!state.apiKey) { return; }
  if (elapsed < PROACTIVE_HOURS * 3600 * 1000) { return; }
  if (apiBusy) { return; } // 手動送信と重なるのを防ぐ
  apiBusy = true;
  // ランダムに1人選んで、時間帯に合った一言を届けてもらう
  var ch = state.chars[Math.floor(Math.random() * state.chars.length)];
  var hour = new Date().getHours();
  var sys = "あなたは「" + ch.name + "」というキャラクターです。設定：" + ch.persona +
    " この性格・口調を必ず全メッセージで一貫して守ってください。" +
    " 今は" + hour + "時です。ユーザー（おみつ）からの返信を待たず、時間帯に合った応援・気づかいのメッセージを自分から送ってください。" +
    " 1〜2個の短いメッセージで、区切りには ||| を使ってください。1メッセージは60文字以内。";
  geminiFetch(sys, historyToContents(ch.id).concat([{ role: "user", parts: [{ text: "（しばらくアプリを開いていなかった）" }] }]), 300)
    .then(function (text) {
      apiBusy = false;
      var out = [];
      var parts = text.split("|||");
      for (var i = 0; i < parts.length && out.length < 2; i++) {
        var t = parts[i].trim();
        if (t) { out.push({ charId: ch.id, text: t }); }
      }
      if (out.length) { addAiMessages(ch.id, out, 0, true); } // 未読バッジ付きで届く
    })
    .catch(function (e) { apiBusy = false; console.error("proactive error", e); }); // 失敗しても静かに無視
}

// ===== 設定画面 =====
function renderSettings() {
  $("set-apikey").value = state.apiKey;
  $("set-model").value = state.model;
  var html = "";
  for (var i = 0; i < state.chars.length; i++) {
    var ch = state.chars[i];
    html += '<section class="bg-white rounded-xl p-4 space-y-3" data-id="' + ch.id + '">' +
      '<div class="flex items-center gap-3">' + iconHtml(ch, "w-14 h-14") +
      '<label class="text-sm text-[#06c755] font-bold cursor-pointer">画像を選ぶ' +
      '<input type="file" accept="image/*" class="icon-input hidden" data-id="' + ch.id + '"></label></div>' +
      '<label class="block text-sm">名前' +
      '<input type="text" class="char-name mt-1 w-full border rounded-lg px-3 py-2" value="' + escapeHtml(ch.name) + '"></label>' +
      '<label class="block text-sm">キャラ設定（性格・口調・応援スタイル）' +
      '<textarea rows="3" class="char-persona mt-1 w-full border rounded-lg px-3 py-2">' + escapeHtml(ch.persona) + '</textarea></label>' +
      '<button class="btn-clear text-sm text-red-500" data-id="' + ch.id + '">この人との履歴を削除</button>' +
      '</section>';
  }
  html += '<section class="bg-white rounded-xl p-4">' +
    '<button class="btn-clear text-sm text-red-500" data-id="' + GROUP_ID + '">グループ「みんな」の履歴を削除</button></section>';
  $("char-settings").innerHTML = html;

  var inputs = document.querySelectorAll(".icon-input");
  for (var j = 0; j < inputs.length; j++) {
    inputs[j].addEventListener("change", onIconSelect);
  }
  var clears = document.querySelectorAll(".btn-clear");
  for (var k = 0; k < clears.length; k++) {
    clears[k].addEventListener("click", function () {
      var id = this.getAttribute("data-id");
      if (confirm(roomName(id) + "の会話履歴を全部消しますか？")) {
        state.histories[id] = [];
        state.unread[id] = 0;
        saveState();
        renderHome();
        alert("削除しました");
      }
    });
  }
}

function onIconSelect(e) {
  var file = e.target.files[0];
  var id = e.target.getAttribute("data-id");
  if (!file) { return; }
  var reader = new FileReader();
  reader.onload = function () {
    var img = new Image();
    img.onload = function () {
      var canvas = document.createElement("canvas");
      var size = 128;
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext("2d");
      var min = Math.min(img.width, img.height);
      var sx = (img.width - min) / 2;
      var sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      getChar(id).icon = canvas.toDataURL("image/jpeg", 0.85);
      saveState();
      renderSettings();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function saveSettings() {
  state.apiKey = $("set-apikey").value.trim();
  state.model = $("set-model").value.trim() || "gemini-2.5-flash";
  var sections = document.querySelectorAll("#char-settings section[data-id]");
  for (var i = 0; i < sections.length; i++) {
    var id = sections[i].getAttribute("data-id");
    var ch = getChar(id);
    if (!ch) { continue; }
    ch.name = sections[i].querySelector(".char-name").value.trim() || ch.name;
    ch.persona = sections[i].querySelector(".char-persona").value.trim();
  }
  saveState();
  renderHome();
  showScreen("home");
}

// ===== イベント登録 =====
$("btn-settings").addEventListener("click", function () { renderSettings(); showScreen("settings"); });
$("btn-settings-back").addEventListener("click", function () { showScreen("home"); });
$("btn-back").addEventListener("click", function () { renderHome(); showScreen("home"); });
$("btn-save").addEventListener("click", saveSettings);
$("btn-send").addEventListener("click", sendMessage);
$("input").addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) {
    e.preventDefault();
    sendMessage();
  }
});
// ③ ワンタップ応援チップ
var chips = document.querySelectorAll(".chip");
for (var ci = 0; ci < chips.length; ci++) {
  chips[ci].addEventListener("click", function () { sendText(this.getAttribute("data-msg")); });
}

renderHome();
checkProactive(); // ① 起動時に「先に届いてるか」チェック

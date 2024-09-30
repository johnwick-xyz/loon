/**
 * 脚本名称：建行生活
 * 活动入口：建行生活APP -> 首页 -> 会员有礼 -> 签到
 * 脚本说明：连续签到领优惠券礼包（打车、外卖优惠券），配置重写手动签到一次即可获取签到数据，默认领取外卖券，可在 BoxJS 配置奖品。兼容 Node.js 环境，变量名称 JHSH_BODY、JHSH_GIFT、JHSH_LOGIN_INFO，多账号分割符 "|"。
 * 仓库地址：https://github.com/FoKit/Scripts
 * 更新时间：2023-10-31  修复多账号 Set-Cookie 参数的串号问题
 * 更新时间：2023-10-30  修复 Cokie 失效问题，增加骑行券类型参数，感谢 Sliverkiss、𝘠𝘶𝘩𝘦𝘯𝘨、苍井灰灰 大佬提供帮助。
 * 更新时间：2024-01-30  修复 Stash 代理工具无法获取 mbc-user-agent 参数问题
 * 更新时间：2024-01-31  增加借记卡用户自动断签功能，非建行信用卡用户连续签到 7 天优惠力度较低(满39元减10元)
 * 更新时间：2024-02-18  修复默认断签问题
 * 更新时间：2024-02-21  修复变量作用域导致无法自动领取签到奖励问题
 * 更新时间：2024-03-27  支持 Node.js 环境读取脚本同目录 box.dat 的 JHSH_SKIPDAY 缓存，内容格式：{"JHSH_SKIPDAY": "3"}
/*

https://raw.githubusercontent.com/FoKit/Scripts/main/boxjs/fokit.boxjs.json
https://raw.githubusercontent.com/FoKit/Scripts/main/rewrite/get_jhsh_cookie.sgmodule

------------------ Surge 配置 -----------------

[MITM]
hostname = yunbusiness.ccb.com

[Script]
建行数据 = type=http-request,pattern=^https:\/\/yunbusiness\.ccb\.com\/(clp_coupon|clp_service)\/txCtrl\?txcode=(A3341A195|autoLogin),requires-body=1,max-size=0,script-path=https://raw.githubusercontent.com/FoKit/Scripts/main/scripts/jhsh_checkIn.js

建行生活 = type=cron,cronexp=17 7 * * *,timeout=60,script-path=https://raw.githubusercontent.com/FoKit/Scripts/main/scripts/jhsh_checkIn.js,script-update-interval=0

------------------ Loon 配置 ------------------

[MITM]
hostname = yunbusiness.ccb.com

[Script]
http-request ^https:\/\/yunbusiness\.ccb\.com\/(clp_coupon|clp_service)\/txCtrl\?txcode=(A3341A195|autoLogin) tag=建行数据, script-path=https://raw.githubusercontent.com/FoKit/Scripts/main/scripts/jhsh_checkIn.js,requires-body=1

cron "17 7 * * *" script-path=https://raw.githubusercontent.com/FoKit/Scripts/main/scripts/jhsh_checkIn.js,tag = 建行生活,enable=true

-------------- Quantumult X 配置 --------------

[MITM]
hostname = yunbusiness.ccb.com

[rewrite_local]
^https:\/\/yunbusiness\.ccb\.com\/(clp_coupon|clp_service)\/txCtrl\?txcode=(A3341A195|autoLogin) url script-request-body https://raw.githubusercontent.com/FoKit/Scripts/main/scripts/jhsh_checkIn.js

[task_local]
17 7 * * * https://raw.githubusercontent.com/FoKit/Scripts/main/scripts/jhsh_checkIn.js, tag=建行生活, enabled=true

------------------ Stash 配置 -----------------

cron:
  script:
    - name: 建行生活
      cron: '17 7 * * *'
      timeout: 10

http:
  mitm:
    - "yunbusiness.ccb.com"
  script:
    - match: ^https:\/\/yunbusiness\.ccb\.com\/(clp_coupon|clp_service)\/txCtrl\?txcode=(A3341A038|autoLogin)
      name: 建行生活
      type: request
      require-body: true

script-providers:
  建行生活:
    url: https://raw.githubusercontent.com/FoKit/Scripts/main/scripts/jhsh_checkIn.js
    interval: 86400

*/


// ccb_checkin.js
// 建行生活签到脚本

const $ = new Env('建行生活');
const notify = $.isNode() ? require('./sendNotify') : '';
let AppId = '1472477795', giftMap = { "1": "打车", "2": "外卖", "3": "骑行" }, message = '';
let giftType = getEnv('JHSH_GIFT') || '2';  // 奖励类型，默认领取'外卖'券
let bodyStr = getEnv('JHSH_BODY') || '';  // 签到所需的 body
let autoLoginInfo = getEnv('JHSH_LOGIN_INFO') || '';  // 刷新 session 所需的数据
let AppVersion = getEnv('JHSH_VERSION') || '2.1.5.002';  // 最新版本号，获取失败时使用
let skipDay = getEnv('JHSH_SKIPDAY') || '';  // 下个断签日 (适用于借记卡用户)
let bodyArr = bodyStr ? bodyStr.split("|") : [];
let bodyArr2 = autoLoginInfo ? autoLoginInfo.split("|") : [];
$.is_debug = getEnv('is_debug') || 'false';

if (isGetCookie = typeof $request !== `undefined`) {
  GetCookie();
  $.done();
} else {
  !(async () => {
    if (!autoLoginInfo || !bodyStr) {
      $.msg($.name, '❌ 请先获取建行生活Cookie。');
      return;
    }
    const date = new Date();
    $.whichDay = date.getDay();
    $.weekMap = {
      0: "星期天",
      1: "星期一",
      2: "星期二",
      3: "星期三",
      4: "星期四",
      5: "星期五",
      6: "星期六",
    };
    if ($.whichDay === parseInt(skipDay)) {
      let text = `今天是断签日[${$.weekMap[$.whichDay]}], 跳过签到任务。`
      console.log(text);
      message += text;
      return;
    }
    console.log(`\n共有[${bodyArr.length}]个建行生活账号\n`);
    await getLatestVersion();  // 获取版本信息
    for (let i = 0; i < bodyArr.length; i++) {
      if (bodyArr[i]) {
        $.index = i + 1;
        $.token = '';
        $.info = JSON.parse(bodyArr[i]);
        $.info2 = JSON.parse(bodyArr2[i]);
        $.giftList = [];
        $.giftList2 = [];
        $.getGiftMsg = "";
        $.isGetGift = false;
        $.DeviceId = $.info2['DeviceId'];
        $.MBCUserAgent = $.info2['MBCUserAgent'];
        $.ALBody = $.info2['Body'];
        console.log(`\n===== 账号[${$.info?.USR_TEL || $.index}]开始签到 =====\n`);
        if (!$.info?.MID || !$.DeviceId || !$.MBCUserAgent || !$.ALBody) {
          message += `🎉 账号 [${$.info?.USR_TEL ? hideSensitiveData($.info?.USR_TEL, 3, 4) : $.index}] 缺少参数，请重新获取Cookie。\n`;
          continue;
        }
        await autoLogin();  // 刷新 session
        if (!$.token) continue;
        await main();  // 签到主函数
        if ($.giftList.length > 0) {
          for (let j = 0; j < $.giftList.length; j++) {
            if ($.isGetGift) break;
            let item = $.giftList[j]
            $.couponId = item?.couponId;
            $.nodeDay = item?.nodeDay;
            $.couponType = item?.couponType;
            $.dccpBscInfSn = item?.dccpBscInfSn;
            $.continue = false;
            console.log(`尝试领取[${giftMap[giftType]}]券`);
            for (let k = 1; k <= 3; k++) {
              if (!$.continue) {
                if (k >= 2) console.log(`领取失败，重试一次`);
                await $.wait(1000 * 5);
                await getGift();  // 领取奖励
                if ($.isGetGift) break;
              }
            }
          };
          if (!$.isGetGift) {
            $.getGiftMsg = `请打开app查看优惠券到账情况。\n`;
          }
          message += "，" + $.getGiftMsg;
        }
        await $.wait(1000 * 3);
      }
    }
  })()
    .catch((e) => {
      $.log('', `❌ ${$.name}, 失败! 原因: ${e}!`, '')
    })
    .finally(async () => {
      if (message) {
        message = message.replace(/\n+$/, '');
        if ($.isNode()) await notify.sendNotify($.name, message);
      }
      $.done();
    });
}

// 请求函数
async function main() {
  let opt = {
    url: `https://yunbusiness.ccb.com/clp_coupon/txCtrl?txcode=A3341A195`,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': $.MBCUserAgent,
    },
    body: $.info['body'],
  };
  return new Promise((resolve) => {
    $.post(opt, (err, resp, data) => {
      try {
        if (err) {
          console.log(`请求失败：${err}`);
          message += `账号${$.index}请求失败。\n`;
        } else {
          let res = JSON.parse(data);
          if (res.code == '000000') {
            console.log('签到成功');
            message += `账号${$.index}签到成功。\n`;
          } else {
            console.log(`签到失败：${res.message}`);
            message += `账号${$.index}签到失败：${res.message}\n`;
          }
        }
      } catch (e) {
        $.logErr(e, resp);
      }
      resolve();
    });
  });
}

// 刷新 session
async function autoLogin() {
  let opt = {
    url: `https://yunbusiness.ccb.com/clp_coupon/txCtrl?txcode=autoLogin`,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': $.MBCUserAgent,
    },
    body: $.ALBody,
  };
  return new Promise((resolve) => {
    $.post(opt, (err, resp, data) => {
      try {
        if (err) {
          console.log(`自动登录失败：${err}`);
        } else {
          let res = JSON.parse(data);
          if (res.code == '000000') {
            $.token = res.data.token;
            console.log(`自动登录成功，获取 token: ${$.token}`);
          } else {
            console.log(`自动登录失败：${res.message}`);
          }
        }
      } catch (e) {
        $.logErr(e, resp);
      }
      resolve();
    });
  });
}

// 获取最新版本信息
async function getLatestVersion() {
  // 可以通过接口请求获取
  console.log(`当前版本为 ${AppVersion}`);
}

// 获取 Cookie
function GetCookie() {
  if (/A3341A195/.test($request.url)) {
    let body = $request.body;
    $.msg($.name, '获取Cookie成功', body);
  }
}

function getEnv(name) {
  if ($.isNode()) {
    return process.env[name];
  } else {
    return $.getdata(name);
  }
}

function hideSensitiveData(data, frontLen, endLen) {
  return data.substring(0, frontLen) + '****' + data.substring(data.length - endLen);
}


// prettier-ignore
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise((e, i) => { s.call(this, t, (t, s, r) => { t ? i(t) : e(s) }) }) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `\ud83d\udd14${this.name}, \u5f00\u59cb!`) } isNode() { return "undefined" != typeof module && !!module.exports } isQuanX() { return "undefined" != typeof $task } isSurge() { return "undefined" != typeof $httpClient && "undefined" == typeof $loon } isLoon() { return "undefined" != typeof $loon } isShadowrocket() { return "undefined" != typeof $rocket } isStash() { return "undefined" != typeof $environment && $environment["stash-version"] } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; const i = this.getdata(t); if (i) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise(e => { this.get({ url: t }, (t, s, i) => e(i)) }) } runScript(t, e) { return new Promise(s => { let i = this.getdata("@chavy_boxjs_userCfgs.httpapi"); i = i ? i.replace(/\n/g, "").trim() : i; let r = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); r = r ? 1 * r : 20, r = e && e.timeout ? e.timeout : r; const [o, a] = i.split("@"), n = { url: `http://${a}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: r }, headers: { "X-Key": o, Accept: "*/*" } }; this.post(n, (t, e, i) => s(i)) }).catch(t => this.logErr(t)) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e); if (!s && !i) return {}; { const i = s ? t : e; try { return JSON.parse(this.fs.readFileSync(i)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e), r = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, r) : i ? this.fs.writeFileSync(e, r) : this.fs.writeFileSync(t, r) } } lodash_get(t, e, s) { const i = e.replace(/\[(\d+)\]/g, ".$1").split("."); let r = t; for (const t of i) if (r = Object(r)[t], void 0 === r) return s; return r } lodash_set(t, e, s) { return Object(t) !== t ? t : (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce((t, s, i) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[i + 1]) >> 0 == +e[i + 1] ? [] : {}, t)[e[e.length - 1]] = s, t) } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, i] = /^@(.*?)\.(.*?)$/.exec(t), r = s ? this.getval(s) : ""; if (r) try { const t = JSON.parse(r); e = t ? this.lodash_get(t, i, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, i, r] = /^@(.*?)\.(.*?)$/.exec(e), o = this.getval(i), a = i ? "null" === o ? null : o || "{}" : "{}"; try { const e = JSON.parse(a); this.lodash_set(e, r, t), s = this.setval(JSON.stringify(e), i) } catch (e) { const o = {}; this.lodash_set(o, r, t), s = this.setval(JSON.stringify(o), i) } } else s = this.setval(t, e); return s } getval(t) { return this.isSurge() || this.isLoon() ? $persistentStore.read(t) : this.isQuanX() ? $prefs.valueForKey(t) : this.isNode() ? (this.data = this.loaddata(), this.data[t]) : this.data && this.data[t] || null } setval(t, e) { return this.isSurge() || this.isLoon() ? $persistentStore.write(t, e) : this.isQuanX() ? $prefs.setValueForKey(t, e) : this.isNode() ? (this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0) : this.data && this.data[e] || null } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { if (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"]), this.isSurge() || this.isLoon()) this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, (t, s, i) => { !t && s && (s.body = i, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, i) }); else if (this.isQuanX()) this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then(t => { const { statusCode: s, statusCode: i, headers: r, body: o } = t; e(null, { status: s, statusCode: i, headers: r, body: o }, o) }, t => e(t && t.error || "UndefinedError")); else if (this.isNode()) { let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", (t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } }).then(t => { const { statusCode: i, statusCode: r, headers: o, rawBody: a } = t, n = s.decode(a, this.encoding); e(null, { status: i, statusCode: r, headers: o, rawBody: a, body: n }, n) }, t => { const { message: i, response: r } = t; e(i, r, r && s.decode(r.rawBody, this.encoding)) }) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; if (t.body && t.headers && !t.headers["Content-Type"] && (t.headers["Content-Type"] = "application/x-www-form-urlencoded"), t.headers && delete t.headers["Content-Length"], this.isSurge() || this.isLoon()) this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, (t, s, i) => { !t && s && (s.body = i, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, i) }); else if (this.isQuanX()) t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then(t => { const { statusCode: s, statusCode: i, headers: r, body: o } = t; e(null, { status: s, statusCode: i, headers: r, body: o }, o) }, t => e(t && t.error || "UndefinedError")); else if (this.isNode()) { let i = require("iconv-lite"); this.initGotEnv(t); const { url: r, ...o } = t; this.got[s](r, o).then(t => { const { statusCode: s, statusCode: r, headers: o, rawBody: a } = t, n = i.decode(a, this.encoding); e(null, { status: s, statusCode: r, headers: o, rawBody: a, body: n }, n) }, t => { const { message: s, response: r } = t; e(s, r, r && i.decode(r.rawBody, this.encoding)) }) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let i = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in i) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? i[e] : ("00" + i[e]).substr(("" + i[e]).length))); return t } msg(e = t, s = "", i = "", r) { const o = t => { if (!t) return t; if ("string" == typeof t) return this.isLoon() ? t : this.isQuanX() ? { "open-url": t } : this.isSurge() ? { url: t } : void 0; if ("object" == typeof t) { if (this.isLoon()) { let e = t.openUrl || t.url || t["open-url"], s = t.mediaUrl || t["media-url"]; return { openUrl: e, mediaUrl: s } } if (this.isQuanX()) { let e = t["open-url"] || t.url || t.openUrl, s = t["media-url"] || t.mediaUrl, i = t["update-pasteboard"] || t.updatePasteboard; return { "open-url": e, "media-url": s, "update-pasteboard": i } } if (this.isSurge()) { let e = t.url || t.openUrl || t["open-url"]; return { url: e } } } }; if (this.isMute || (this.isSurge() || this.isLoon() ? $notification.post(e, s, i, o(r)) : this.isQuanX() && $notify(e, s, i, o(r))), !this.isMuteLog) { let t = ["", "==============\ud83d\udce3\u7cfb\u7edf\u901a\u77e5\ud83d\udce3=============="]; t.push(e), s && t.push(s), i && t.push(i), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { const s = !this.isSurge() && !this.isQuanX() && !this.isLoon(); s ? this.log("", `\u2757\ufe0f${this.name}, \u9519\u8bef!`, t.stack) : this.log("", `\u2757\ufe0f${this.name}, \u9519\u8bef!`, t) } wait(t) { return new Promise(e => setTimeout(e, t)) } done(t = {}) { const e = (new Date).getTime(), s = (e - this.startTime) / 1e3; this.log("", `\ud83d\udd14${this.name}, \u7ed3\u675f! \ud83d\udd5b ${s} \u79d2`), this.log(), this.isSurge() || this.isQuanX() || this.isLoon() ? $done(t) : this.isNode() && process.exit(1) } }(t, e) }

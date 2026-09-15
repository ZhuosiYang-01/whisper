"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { localDate, localDateTime } from "@/lib/dates";

type Note = { id: string; body: string; created_at: string; delivered_at: string };
type UnreadNote = { id: string; delivered_at: string };
type AppPhase = "loading" | "username" | "space" | "invite" | "dashboard";
type MyContext = { username: string; timezone: string; space_id: string | null; partner_username: string | null; partner_timezone: string | null; member_count: number };
type InvitePreview = { inviter_username: string | null; invite_status: "ready" | "invalid" | "expired" | "full" };

const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const timeZoneOptions = (() => {
  const supportedValuesOf = (Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf;
  const detected = deviceTimeZone();
  const values = supportedValuesOf ? supportedValuesOf("timeZone") : ["Asia/Shanghai", "Asia/Hong_Kong", "Asia/Tokyo", "Europe/London", "America/New_York", "America/Los_Angeles", "UTC"];
  return values.includes(detected) ? values : [detected, ...values];
})();

function timeInZone(timeZone: string) {
  try { return new Intl.DateTimeFormat("zh-CN", { timeZone, month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()); }
  catch { return "时区暂时无法识别"; }
}

export function PaperApp() {
  const [phase, setPhase] = useState<AppPhase>("loading");
  const [context, setContext] = useState<MyContext | null>(null);
  const [inviteToken, setInviteToken] = useState("");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [error, setError] = useState("");
  const clientRef = useRef<SupabaseClient | null>(null);

  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js");
    const search = new URLSearchParams(window.location.search);
    const token = search.get("invite") ?? "";
    setInviteToken(token);
    if (!isSupabaseConfigured()) { setPhase("username"); return; }
    const supabase = createClient();
    clientRef.current = supabase;
    void initialize(supabase, token);
  }, []);

  async function initialize(supabase: SupabaseClient, token: string) {
    setError("");
    const existing = await supabase.auth.getSession();
    const session = existing.data.session;
    if (!session) { setPhase("username"); return; }
    const { data, error: contextError } = await supabase.rpc("get_my_context");
    if (contextError) { setError("纸条屋暂时没连上，请刷新再试。"); setPhase("username"); return; }
    const mine = Array.isArray(data) ? data[0] as MyContext | undefined : undefined;
    if (!mine?.username) { setPhase("username"); return; }
    setContext(mine);
    if (mine.partner_username) { setPhase("dashboard"); return; }
    if (token) { await loadInvitePreview(supabase, token); setPhase("invite"); return; }
    setPhase("space");
  }

  async function refreshContext() {
    const supabase = clientRef.current;
    if (!supabase) return;
    const { data } = await supabase.rpc("get_my_context");
    const mine = Array.isArray(data) ? data[0] as MyContext | undefined : undefined;
    if (mine) setContext(mine);
  }

  async function loadInvitePreview(supabase: SupabaseClient, token: string) {
    const { data } = await supabase.rpc("get_invite_preview", { raw_token: token });
    const item = Array.isArray(data) ? data[0] as InvitePreview | undefined : undefined;
    setPreview(item ?? { inviter_username: null, invite_status: "invalid" });
  }

  async function claimUsername(name: string, timezone: string) {
    const supabase = clientRef.current;
    setError("");
    if (!supabase) {
      const saved = JSON.parse(localStorage.getItem("paper-preview-usernames") ?? "[]") as string[];
      if (saved.some((item) => item.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        setError("这个用户名已经被占用，换一个试试吧。");
        return;
      }
      localStorage.setItem("paper-preview-usernames", JSON.stringify([...saved, name]));
      setContext({ username: name, timezone, space_id: null, partner_username: null, partner_timezone: null, member_count: 0 });
      setPhase("space");
      return;
    }
    const current = (await supabase.auth.getSession()).data.session;
    if (!current || current.user.is_anonymous) {
      if (current) await supabase.auth.signOut();
      const credentials = await usernameCredentials(name);
      const registration = await supabase.auth.signUp(credentials);
      if (registration.error || !registration.data.session) {
        setError(registration.error?.message.toLowerCase().includes("registered") ? "这个用户名已经被占用，换一个试试吧。" : "注册没有完成，请确认 Supabase 已关闭邮箱验证后再试。");
        return;
      }
    }
    const { error: claimError } = await supabase.rpc("claim_username", { desired_username: name });
    if (claimError) { setError(friendlyError(claimError.message)); return; }
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) { setError("注册没有完成，请重新试一次。"); return; }
    const { error: timezoneError } = await supabase.from("profiles").update({ timezone }).eq("id", session.user.id);
    if (timezoneError) { setError("时区没有保存成功，请重新选择后再试。"); return; }
    await refreshContext();
    if (inviteToken) { await loadInvitePreview(supabase, inviteToken); setPhase("invite"); }
    else setPhase("space");
  }

  async function loginUsername(name: string) {
    const supabase = clientRef.current;
    setError("");
    if (!supabase) {
      const saved = JSON.parse(localStorage.getItem("paper-preview-usernames") ?? "[]") as string[];
      const matched = saved.find((item) => item.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (!matched) { setError("没有找到这个用户名，再检查一下吧。"); return; }
      setContext({ username: matched, timezone: deviceTimeZone(), space_id: null, partner_username: null, partner_timezone: null, member_count: 0 });
      setPhase("space");
      return;
    }
    const credentials = await usernameCredentials(name);
    const { error: loginError } = await supabase.auth.signInWithPassword(credentials);
    if (loginError) { setError("没有找到这个用户名，再检查一下吧。"); return; }
    const { data } = await supabase.rpc("get_my_context");
    const mine = Array.isArray(data) ? data[0] as MyContext | undefined : undefined;
    if (!mine) { await supabase.auth.signOut(); setError("没有找到这个用户名，再检查一下吧。"); return; }
    setContext(mine);
    if (mine.partner_username) setPhase("dashboard");
    else if (inviteToken) { await loadInvitePreview(supabase, inviteToken); setPhase("invite"); }
    else setPhase("space");
  }

  async function createSpace() {
    const supabase = clientRef.current;
    setError("");
    if (!supabase) {
      setInviteUrl(`${window.location.origin}/?invite=preview-${crypto.randomUUID()}&preview=signup`);
      return;
    }
    const { data, error: createError } = await supabase.rpc("create_space_with_invite");
    if (createError) { setError(friendlyError(createError.message)); return; }
    setInviteUrl(`${window.location.origin}/?invite=${encodeURIComponent(String(data))}`);
    await refreshContext();
  }

  async function switchAccount() {
    const supabase = clientRef.current;
    setError("");
    setInviteUrl("");
    setContext(null);
    if (supabase) await supabase.auth.signOut();
    window.history.replaceState({}, "", window.location.pathname);
    setPhase("username");
  }

  async function acceptInvite() {
    const supabase = clientRef.current;
    if (!supabase || !inviteToken) return;
    setError("");
    const { error: acceptError } = await supabase.rpc("accept_invite", { raw_token: inviteToken });
    if (acceptError) { setError(friendlyError(acceptError.message)); return; }
    await refreshContext();
    window.history.replaceState({}, "", window.location.pathname);
    setPhase("dashboard");
  }

  if (phase === "loading") return <FlowShell><p className="flow-loading">正在铺好一张新纸……</p></FlowShell>;
  if (phase === "username") return <FlowShell><UsernameStep submit={claimUsername} login={loginUsername} error={error} clearError={() => setError("")} /></FlowShell>;
  if (phase === "space") return <FlowShell><SpaceStep username={context?.username ?? ""} inviteUrl={inviteUrl} create={createSpace} switchAccount={switchAccount} error={error} /></FlowShell>;
  if (phase === "invite") return <FlowShell><InviteStep preview={preview} accept={acceptInvite} error={error} /></FlowShell>;
  return <Dashboard partner={context?.partner_username ?? "TA"} timezone={context?.timezone ?? deviceTimeZone()} partnerTimezone={context?.partner_timezone ?? "UTC"} client={clientRef.current} />;
}

function FlowShell({ children }: { children: React.ReactNode }) {
  return <main className="desk flow-desk"><section className="flow-paper"><a className="flow-logo" href="/">纸条</a>{children}</section></main>;
}

function UsernameStep({ submit, login, error, clearError }: { submit: (name: string, timezone: string) => Promise<void>; login: (name: string) => Promise<void>; error: string; clearError: () => void }) {
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState(deviceTimeZone);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"register" | "login">("register");
  async function onSubmit(event: FormEvent) { event.preventDefault(); setBusy(true); await (mode === "register" ? submit(name.trim(), timezone) : login(name.trim())); setBusy(false); }
  function switchMode() { setMode((value) => value === "register" ? "login" : "register"); setName(""); clearError(); }
  return <div className="flow-content"><h1>{mode === "register" ? "先给自己取个名字" : "欢迎回来"}</h1><form className="flow-form" onSubmit={onSubmit}><input id="username" name="username" aria-label="用户名" placeholder={mode === "login" ? "填写你的用户名" : undefined} value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={20} pattern="[A-Za-z0-9_\u4e00-\u9fa5]+" autoComplete="username" autoFocus required aria-describedby="username-hint username-error" />{mode === "register" && <><small id="username-hint">2 到 20 个字，可用中文、字母、数字和下划线。</small><TimeZoneField value={timezone} onChange={setTimezone} label="选择你的时区" hint="已经按当前设备自动选择，你也可以换一个。" /></>}{error && <p className="flow-error" id="username-error" role="alert">{error}</p>}<button className="flow-primary" disabled={busy || name.trim().length < 2}>{busy ? (mode === "register" ? "正在写下名字…" : "正在回来…") : (mode === "register" ? "就叫这个名字" : "登录")}</button><button className="account-switch" type="button" onClick={switchMode}>{mode === "register" ? "已有账号？点击登录" : "还没有账号？返回注册"}</button></form></div>;
}

function TimeZoneField({ value, onChange, label, hint }: { value: string; onChange: (value: string) => void; label: string; hint?: string }) {
  return <label className="timezone-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{timeZoneOptions.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select>{hint && <small>{hint}</small>}</label>;
}

async function usernameCredentials(username: string) {
  const bytes = new TextEncoder().encode(username.trim().toLocaleLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { email: `paper-${key}@users.invalid`, password: `Paper-${key.slice(0, 32)}!` };
}

function SpaceStep({ username, inviteUrl, create, switchAccount, error }: { username: string; inviteUrl: string; create: () => Promise<void>; switchAccount: () => Promise<void>; error: string }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function makeSpace() { setBusy(true); await create(); setBusy(false); }
  async function copy() { await navigator.clipboard.writeText(inviteUrl); setCopied(true); }
  return <div className="flow-content"><h1>嗨，{username}</h1>{!inviteUrl ? <><p>创建一个只属于两个人的小空间，再把邀请链接发给想一起写纸条的人。</p>{error && <p className="flow-error" role="alert">{error}</p>}<button className="flow-primary" onClick={makeSpace} disabled={busy}>{busy ? "正在准备小空间…" : "创建双人空间"}</button></> : <><p>小空间准备好啦。这个链接只能成功加入一位伙伴，有效期是 7 天。</p><div className="invite-link"><input value={inviteUrl} readOnly aria-label="邀请链接" /><button onClick={copy}>{copied ? "复制好啦" : "复制链接"}</button></div><p className="flow-aside">等对方加入后，刷新页面就能看到彼此。</p></>}<button className="account-switch space-switch" type="button" onClick={switchAccount}>返回注册 / 登录</button></div>;
}

function InviteStep({ preview, accept, error }: { preview: InvitePreview | null; accept: () => Promise<void>; error: string }) {
  const [busy, setBusy] = useState(false);
  async function join() { setBusy(true); await accept(); setBusy(false); }
  if (!preview) return <p className="flow-loading">正在看看是谁邀请了你……</p>;
  const messages = { invalid: "这个邀请链接不太对，请让对方重新发一次。", expired: "这个邀请已经过期，请让对方重新生成一个。", full: "这个小空间已经住满两个人啦。" };
  if (preview.invite_status !== "ready") return <div className="flow-content"><h1>差一点点</h1><p>{messages[preview.invite_status]}</p><a className="flow-secondary" href="/">回到纸条</a></div>;
  return <div className="flow-content"><h1>{preview.inviter_username} 在等你</h1><p>接受后，你们会进入同一个双人空间。每个人都只能加入一个空间。</p>{error && <p className="flow-error" role="alert">{error}</p>}<button className="flow-primary" onClick={join} disabled={busy}>{busy ? "正在加入…" : "接受邀请，一起写纸条"}</button></div>;
}

function friendlyError(message: string) {
  if (message.includes("username_taken")) return "这个用户名已经被占用，换一个试试吧。";
  if (message.includes("username_invalid")) return "用户名格式不对，请使用 2 到 20 个中文、字母、数字或下划线。";
  if (message.includes("invite_invalid")) return "邀请已失效，请让对方重新发一个。";
  if (message.includes("space_full")) return "这个小空间已经住满两个人啦。";
  if (message.includes("already_bound")) return "你已经加入另一个双人空间了。";
  if (message.includes("delivery_in_past")) return "按对方时区计算，这个时间已经过去了，请重新选择。";
  if (message.includes("invalid_delivery_rule")) return "送达时间没有填完整，请再检查一下。";
  return "刚刚没成功，请检查网络后再试一次。";
}

function Dashboard({ partner, timezone, partnerTimezone, client }: { partner: string; timezone: string; partnerTimezone: string; client: SupabaseClient | null }) {
  const [composeOpen, setComposeOpen] = useState(false), [activeNote, setActiveNote] = useState<Note | null>(null), [unread, setUnread] = useState<UnreadNote[]>([]), [received, setReceived] = useState<Note[]>([]), [pending, setPending] = useState(0), [loadError, setLoadError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (activeNote) closeRef.current?.focus(); }, [activeNote]);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    async function load() {
      const [pendingResult, unreadResult, receivedResult] = await Promise.all([
        client!.rpc("pending_note_count"),
        client!.rpc("unread_note_index"),
        client!.from("notes").select("id, body, created_at, delivered_at").eq("status", "opened").order("delivered_at", { ascending: false }),
      ]);
      if (cancelled) return;
      const firstError = pendingResult.error ?? unreadResult.error ?? receivedResult.error;
      if (firstError) { setLoadError("纸条暂时没有读出来，请刷新再试。"); return; }
      setPending(Number(pendingResult.data ?? 0));
      setUnread((unreadResult.data ?? []) as UnreadNote[]);
      setReceived((receivedResult.data ?? []) as Note[]);
    }
    void load();
    return () => { cancelled = true; };
  }, [client]);
  async function openNote(note: UnreadNote) {
    if (!client) return;
    setLoadError("");
    const { data, error } = await client.rpc("open_note", { note_id: note.id });
    const opened = Array.isArray(data) ? data[0] as Note | undefined : undefined;
    if (error || !opened) { setLoadError("这张纸条暂时打不开，请稍后再试。"); return; }
    setUnread((items) => items.filter((item) => item.id !== note.id));
    setReceived((items) => [opened, ...items.filter((item) => item.id !== opened.id)]);
    setActiveNote(opened);
  }
  async function enableNotifications() { if (!("Notification" in window)) return alert("当前浏览器不支持通知。"); const permission = await Notification.requestPermission(); if (permission !== "granted") alert("通知没有开启，可稍后在浏览器设置中更改。"); }
  return <main className="desk"><section className="paper" aria-label="我的纸条"><header className="masthead"><h1>纸条</h1><p>你和 <strong>{partner}</strong></p></header><aside className="summary"><p className="relationship">我们的小角落</p><h2>待发送纸条</h2><p className="pending-count"><span>{pending}</span> 条</p><div className="notification-note"><BellIcon /><div><p>打开提醒，新纸条到了就告诉你。</p><button className="text-button" onClick={enableNotifications}>去打开提醒</button><p className="ios-note">用 iPhone 的话，先在 Safari 里添加到主屏幕哦。</p></div></div></aside><div className="ledger">{loadError && <p className="dashboard-error" role="alert">{loadError}</p>}<section className="note-section"><div className="section-heading"><h2>未读纸条</h2><span>共 {unread.length} 条</span></div>{unread.length ? unread.map((note) => <div className="unread-row" key={note.id}><time dateTime={note.delivered_at}>{localDate(note.delivered_at)}</time><button className="open-button" onClick={() => void openNote(note)}>打开</button></div>) : <p className="empty-line">这里暂时空空的，晚点再来看看吧。</p>}</section><section className="note-section"><div className="section-heading"><h2>收到的纸条</h2><span>共 {received.length} 条</span></div>{received.length ? received.map((note) => <article className="received-note" key={note.id}><dl><div><dt>写下</dt><dd className="date-text">{localDate(note.created_at)}</dd></div><div><dt>送达</dt><dd className="date-text">{localDate(note.delivered_at)}</dd></div></dl><p>{note.body}</p></article>) : <p className="empty-line">打开过的纸条会留在这里。</p>}</section></div><button className="compose-tab" onClick={() => setComposeOpen(true)}><span>留一张纸条</span></button><TimeZoneSettings client={client} initialTimezone={timezone} /></section>{activeNote && <NoteDialog note={activeNote} close={() => setActiveNote(null)} closeRef={closeRef} />}{composeOpen && <ComposeDialog client={client} partner={partner} partnerTimezone={partnerTimezone} close={() => setComposeOpen(false)} sealed={() => { setPending((value) => value + 1); setComposeOpen(false); }} />}</main>;
}

function TimeZoneSettings({ client, initialTimezone }: { client: SupabaseClient | null; initialTimezone: string }) {
  const [timezone, setTimezone] = useState(initialTimezone), [status, setStatus] = useState("");
  async function save() {
    if (!client) return;
    setStatus("正在保存…");
    const session = (await client.auth.getSession()).data.session;
    const { error } = session ? await client.from("profiles").update({ timezone }).eq("id", session.user.id) : { error: new Error("not_signed_in") };
    setStatus(error ? "没有保存成功，请稍后再试。" : "已保存，以后会按这个时区接收纸条。");
  }
  return <section className="timezone-settings" aria-labelledby="timezone-settings-title"><div><h2 id="timezone-settings-title">我的时区</h2><p>当前时间：<span className="date-text">{timeInZone(timezone)}</span></p></div><TimeZoneField value={timezone} onChange={(value) => { setTimezone(value); setStatus(""); }} label="选择或更换时区" /><button type="button" className="timezone-save" onClick={() => void save()}>保存时区</button>{status && <p className="timezone-status" role="status">{status}</p>}</section>;
}

function NoteDialog({ note, close, closeRef }: { note: Note; close: () => void; closeRef: React.RefObject<HTMLButtonElement | null> }) { return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}><section className="note-dialog" role="dialog" aria-modal="true" aria-labelledby="note-title"><button ref={closeRef} className="close-button" onClick={close} aria-label="关闭">×</button><h2 id="note-title">纸条到啦</h2><p className="dialog-body">{note.body}</p><dl className="dialog-dates"><div><dt>写下</dt><dd className="date-text">{localDateTime(note.created_at)}</dd></div><div><dt>送达</dt><dd className="date-text">{localDateTime(note.delivered_at)}</dd></div></dl></section></div>; }

function ComposeDialog({ client, partner, partnerTimezone, close, sealed }: { client: SupabaseClient | null; partner: string; partnerTimezone: string; close: () => void; sealed: () => void }) {
  const [mode, setMode] = useState<"fixed" | "random">("fixed"), [basis, setBasis] = useState<"days" | "date">("days"), [body, setBody] = useState(""), [days, setDays] = useState("0"), [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA")), [time, setTime] = useState("21:30"), [randomWindow, setRandomWindow] = useState("7"), [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function send() {
    if (!client) { setError("纸条暂时没有连上，请刷新后再试。"); return; }
    setBusy(true); setError("");
    const { error: sealError } = await client.rpc("seal_note", {
      note_body: body,
      kind: mode,
      days_after: mode === "fixed" && basis === "days" ? Number(days) : null,
      delivery_date: mode === "fixed" && basis === "date" ? date : null,
      local_time: mode === "fixed" ? time : null,
      random_window: mode === "random" ? Number(randomWindow) : null,
    });
    setBusy(false);
    if (sealError) { setError(friendlyError(sealError.message)); return; }
    sealed();
  }
  return <div className="modal-backdrop"><section className="compose-dialog" role="dialog" aria-modal="true" aria-labelledby="compose-title"><button className="close-button" onClick={close} aria-label="关闭">×</button><h2 id="compose-title">留一张纸条</h2>{!confirming ? <form onSubmit={(event) => { event.preventDefault(); setConfirming(true); }}><label className="writing-field">正文<textarea required maxLength={2000} placeholder="写下想在未来抵达的话…" value={body} onChange={(event) => setBody(event.target.value)} /></label><fieldset><legend>什么时候抵达</legend><div className="mode-switch"><button type="button" aria-pressed={mode === "fixed"} onClick={() => setMode("fixed")}>按时间</button><button type="button" aria-pressed={mode === "random"} onClick={() => setMode("random")}>随机一天</button></div>{mode === "fixed" ? <div className="schedule-submenu"><p>按时间，可以这样选日期</p><div className="mode-switch schedule-basis"><button type="button" aria-pressed={basis === "days"} onClick={() => setBasis("days")}>按天数</button><button type="button" aria-pressed={basis === "date"} onClick={() => setBasis("date")}>选日期</button></div><div className="delivery-fields"><label><span>{basis === "days" ? "几天后" : "送达日期"}</span>{basis === "days" ? <input type="number" min="0" max="365" value={days} onChange={(event) => setDays(event.target.value)} required /> : <input type="date" min={new Date().toLocaleDateString("en-CA")} value={date} onChange={(event) => setDate(event.target.value)} required />}</label><label><span>在几点</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} required /></label></div><div className="partner-clock"><span>{partner} 当前时间</span><strong className="date-text">{timeInZone(partnerTimezone)}</strong><small>{partnerTimezone}</small></div><small className="timezone-hint">送达时间按照对方设置的时区计算。</small></div> : <label className="random-field"><span>时间范围</span><select value={randomWindow} onChange={(event) => setRandomWindow(event.target.value)}><option value="3">3 天内随机</option><option value="7">7 天内随机</option><option value="14">14 天内随机</option><option value="30">30 天内随机</option></select><small>具体送达时间会立即锁定，但你们都不会看到。</small></label>}</fieldset><button className="seal-button">放进时间里</button></form> : <div className="confirm-seal"><p>送出以后，就不能再偷看、修改或收回啦。</p>{error && <p className="flow-error" role="alert">{error}</p>}<div><button className="text-button" onClick={() => setConfirming(false)} disabled={busy}>我再看看</button><button className="seal-button" onClick={() => void send()} disabled={busy}>{busy ? "正在送出…" : "好，送它出发"}</button></div></div>}</section></div>;
}

function BellIcon() { return <svg className="bell" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.8 10.3c0-3.4 1.7-5.5 5.2-5.5s5.2 2.1 5.2 5.5c0 4 1.7 5.2 2.3 6.1H4.5c.6-.9 2.3-2.1 2.3-6.1ZM9.8 19c.5.7 1.2 1.1 2.2 1.1s1.7-.4 2.2-1.1" /></svg>; }

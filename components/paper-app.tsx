"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import "./received-stack.css";
import { UnreadFolder as UnreadDrawer } from "./unread-folder";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAllCountries, getCountryForTimezone, getTimezone, getTimezonesForCountry } from "countries-and-timezones";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { localDate, localDateTime } from "@/lib/dates";

type Note = { id: string; body: string; created_at: string; delivered_at: string };
type UnreadNote = { id: string; delivered_at: string };
type AppPhase = "loading" | "username" | "space" | "invite" | "dashboard";
type MyContext = { username: string; timezone: string; space_id: string | null; partner_username: string | null; partner_timezone: string | null; member_count: number };
type InvitePreview = { inviter_username: string | null; invite_status: "ready" | "invalid" | "expired" | "full" };

const sisiMockNotes: Note[] = [
  ["mock-unread-01", "今天路过一家很可爱的小店，下次想和你一起去。", "2026-09-15T13:10:00Z"],
  ["mock-unread-02", "记得好好吃饭，也记得偶尔偷个懒。", "2026-09-14T16:20:00Z"],
  ["mock-unread-03", "刚刚看到一朵很像小兔子的云。", "2026-09-13T11:30:00Z"],
  ["mock-unread-04", "今天的晚风很好，想分一半给你。", "2026-09-12T18:40:00Z"],
  ["mock-unread-05", "有一件开心的小事，见面的时候告诉你。", "2026-09-11T09:15:00Z"],
  ["mock-unread-06", "辛苦啦，今天也已经做得很好了。", "2026-09-10T14:50:00Z"],
  ["mock-unread-07", "下雨的时候突然很想和你一起散步。", "2026-09-09T10:05:00Z"],
  ["mock-unread-08", "给你留一颗今天份的小星星。", "2026-09-08T20:10:00Z"],
  ["mock-unread-09", "最近听到一首很好听的歌，想分享给你。", "2026-09-07T12:25:00Z"],
  ["mock-unread-10", "等忙完这一阵，我们一起去吃点好吃的吧。", "2026-09-06T15:35:00Z"],
].map(([id, body, delivered_at], index) => ({ id, body, delivered_at, created_at: new Date(new Date(delivered_at).getTime() - (index + 1) * 86400000).toISOString() }));

const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const regionNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });
const countryOptions = Object.values(getAllCountries()).map((country) => ({ value: country.id, label: regionNames.of(country.id) ?? country.name })).sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));

const familiarTimeZones: Record<string, string> = {
  "Asia/Shanghai": "北京时间（北京、香港、新加坡）",
  "Asia/Hong_Kong": "北京时间（北京、香港、新加坡）",
  "Asia/Singapore": "北京时间（北京、香港、新加坡）",
  "Asia/Tokyo": "日本时间（东京、大阪）",
  "Asia/Seoul": "韩国时间（首尔）",
  "Asia/Kolkata": "印度时间（新德里、孟买）",
  "Asia/Dubai": "阿联酋时间（迪拜）",
  "Europe/London": "英国时间（伦敦）",
  "Europe/Paris": "欧洲中部时间（巴黎、柏林、罗马）",
  "Europe/Berlin": "欧洲中部时间（巴黎、柏林、罗马）",
  "America/New_York": "美东时间（纽约、多伦多）",
  "America/Chicago": "美中时间（芝加哥、休斯敦）",
  "America/Denver": "美山时间（丹佛）",
  "America/Los_Angeles": "美西时间（洛杉矶、温哥华）",
  "America/Anchorage": "阿拉斯加时间（安克雷奇）",
  "Pacific/Honolulu": "夏威夷时间（檀香山）",
  "Australia/Sydney": "澳大利亚东部时间（悉尼、墨尔本）",
  "Pacific/Auckland": "新西兰时间（奥克兰）",
  UTC: "世界标准时间",
};

const preferredZones: Record<string, string[]> = {
  US: ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "America/Adak", "Pacific/Honolulu"],
  CA: ["America/St_Johns", "America/Halifax", "America/Toronto", "America/Winnipeg", "America/Edmonton", "America/Vancouver", "America/Whitehorse"],
  AU: ["Australia/Sydney", "Australia/Adelaide", "Australia/Brisbane", "Australia/Darwin", "Australia/Perth", "Australia/Lord_Howe"],
  BR: ["America/Noronha", "America/Sao_Paulo", "America/Manaus", "America/Rio_Branco"],
  RU: ["Europe/Kaliningrad", "Europe/Moscow", "Europe/Samara", "Asia/Yekaterinburg", "Asia/Omsk", "Asia/Novosibirsk", "Asia/Irkutsk", "Asia/Yakutsk", "Asia/Vladivostok", "Asia/Magadan", "Asia/Kamchatka"],
};

function timeZoneOffset(timeZone: string, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return Math.round((Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day), Number(value.hour), Number(value.minute), Number(value.second)) - date.getTime()) / 60000);
  } catch { return 0; }
}

function offsetLabel(minutes: number) {
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const rest = absolute % 60;
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

function timeZoneLabel(timeZone: string, date = new Date()) {
  try {
    const localized = new Intl.DateTimeFormat("zh-CN", { timeZone, timeZoneName: "longGeneric" }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
    return `${familiarTimeZones[timeZone] ?? localized ?? "当地时间"}，${offsetLabel(timeZoneOffset(timeZone, date))}`;
  } catch { return familiarTimeZones[timeZone] ?? "当地时间"; }
}

function zonesForCountry(countryCode: string) {
  const zones = getTimezonesForCountry(countryCode) ?? [];
  const ordered = [...(preferredZones[countryCode] ?? []).map((name) => zones.find((zone) => zone.name === name)).filter(Boolean), ...zones];
  const groups = new Map<string, string>();
  for (const zone of ordered) {
    if (!zone) continue;
    const canonical = zone.aliasOf ?? zone.name;
    const details = getTimezone(canonical) ?? zone;
    const key = `${details.utcOffset}:${details.dstOffset}`;
    if (!groups.has(key)) groups.set(key, canonical);
  }
  return [...groups.entries()].map(([key, zone]) => ({ key, zone, label: timeZoneLabel(zone) }));
}

function countryForTimeZone(timeZone: string) {
  return getCountryForTimezone(timeZone)?.id ?? "CN";
}

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
    if (process.env.NODE_ENV === "production") navigator.serviceWorker?.register("/sw.js");
    else navigator.serviceWorker?.getRegistrations().then((registrations) => registrations.forEach((registration) => registration.unregister()));
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
  return <Dashboard username={context?.username ?? ""} partner={context?.partner_username ?? "TA"} timezone={context?.timezone ?? deviceTimeZone()} partnerTimezone={context?.partner_timezone ?? "UTC"} client={clientRef.current} />;
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
  const [country, setCountry] = useState<string>(() => countryForTimeZone(value));
  const zones = zonesForCountry(country);
  const currentDetails = getTimezone(value);
  const currentKey = currentDetails ? `${currentDetails.utcOffset}:${currentDetails.dstOffset}` : zones[0]?.key;
  const selectedZone = zones.find((item) => item.key === currentKey)?.zone ?? zones[0]?.zone ?? value;
  function changeCountry(nextCountry: string) {
    setCountry(nextCountry);
    const nextZone = zonesForCountry(nextCountry)[0]?.zone;
    if (nextZone) onChange(nextZone);
  }
  return <div className="timezone-field"><label><span>{label}</span><select value={country} onChange={(event) => changeCountry(event.target.value)}>{countryOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{zones.length > 1 && <label><span>时区</span><select value={selectedZone} onChange={(event) => onChange(event.target.value)}>{zones.map((item) => <option key={item.key} value={item.zone}>{item.label}</option>)}</select></label>}{zones.length === 1 && <p className="timezone-auto">当地时间：{zones[0].label}</p>}{hint && <small>{hint}</small>}</div>;
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

const paperKinds = ["envelope", "note", "torn", "parcel"] as const;

function LegacyUnreadDrawer({ notes, open }: { notes: UnreadNote[]; open: (note: UnreadNote) => void }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const bounceRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const swipeRef = useRef<{ id: number; startX: number; moved: boolean } | null>(null);
  const suppressTapRef = useRef(false);
  const [activeCard, setActiveCard] = useState(0);
  const visibleNotes = notes.slice(0, 10);
  useEffect(() => { setActiveCard((current) => Math.min(current, Math.max(0, visibleNotes.length - 1))); }, [visibleNotes.length]);
  const cardTransforms = useMemo(() => {
    return visibleNotes.map((_, index) => {
      const distance = index - activeCard;
      const scale = Math.max(0.76, 1 - Math.abs(distance) * 0.045);
      return `translate(-50%, 0) translateX(${(distance * 27).toFixed(1)}px) translateY(${(-88 + Math.abs(distance) * 7).toFixed(1)}px) rotate(${(distance * 4.5).toFixed(1)}deg) scale(${scale.toFixed(3)})`;
    });
  }, [activeCard, visibleNotes.length]);
  useEffect(() => {
    if (!drawerOpen || !bounceRef.current) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cards = cardRefs.current.filter(Boolean);
    gsap.set(cards, { transform: "translate(-50%, 10%) scale(0.94)", opacity: 0 });
    let animation: gsap.core.Tween | undefined;
    const frame = window.requestAnimationFrame(() => {
      animation = gsap.to(cards, { transform: (index) => cardTransforms[index], opacity: 1, stagger: reduceMotion ? 0 : 0.045, duration: reduceMotion ? 0.12 : 0.28, ease: reduceMotion ? "power3.out" : "back.out(1.4)", overwrite: true });
    });
    return () => { window.cancelAnimationFrame(frame); animation?.kill(); };
  }, [drawerOpen, visibleNotes.length]);
  function toggleFolder() {
    setDrawerOpen((value) => !value);
  }
  function pushCards(hoveredIndex: number) {
    if (!drawerOpen || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    cardRefs.current.forEach((card, index) => {
      if (!card) return;
      gsap.killTweensOf(card);
      const base = cardTransforms[index] ?? "none";
      const transform = index === hoveredIndex ? base.replace(/rotate\([\s\S]*?\)/, "rotate(0deg)") : `${base} translateX(${index < hoveredIndex ? -42 : 42}px)`;
      gsap.to(card, { transform, scale: index === hoveredIndex ? 1.08 : 1, duration: 0.24, ease: "back.out(1.4)", overwrite: "auto" });
    });
  }
  function resetCards() {
    cardRefs.current.forEach((card, index) => {
      if (!card) return;
      gsap.killTweensOf(card);
      gsap.to(card, { transform: cardTransforms[index] ?? "none", scale: 1, duration: 0.24, ease: "back.out(1.4)", overwrite: "auto" });
    });
  }
  function openCard(note: UnreadNote, index: number) {
    if (suppressTapRef.current) return;
    const card = cardRefs.current[index];
    if (!card || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { open(note); return; }
    gsap.killTweensOf(card);
    card.style.zIndex = "40";
    gsap.to(card, { transform: "translate(-50%, 0) translateY(-108px) rotate(0deg) scale(1.28)", duration: 0.2, ease: "power3.out", overwrite: true, onComplete: () => open(note) });
  }
  return <section className="unread-folder react-bits-folder-section" aria-labelledby="unread-title" data-open={drawerOpen}>
    <div className="folder-heading"><div><h2 id="unread-title">未读纸条</h2><p>{notes.length ? `有${notes.length}张没看过的纸条` : "暂时空空的"}</p></div></div>
    <div className={`react-folder ${drawerOpen ? "open" : ""}`}>
      <div className="react-folder-back">
        <div className="react-folder-papers bounce-cards" ref={bounceRef} id="unread-folder-content" aria-hidden={!drawerOpen} onMouseLeave={resetCards} onPointerDown={(event) => { if (!drawerOpen || swipeRef.current) return; swipeRef.current = { id: event.pointerId, startX: event.clientX, moved: false }; }} onPointerMove={(event) => { const swipe = swipeRef.current; if (!swipe || swipe.id !== event.pointerId) return; if (Math.abs(event.clientX - swipe.startX) > 10) { swipe.moved = true; event.currentTarget.setPointerCapture(event.pointerId); } }} onPointerUp={(event) => { const swipe = swipeRef.current; swipeRef.current = null; if (!swipe || !swipe.moved) return; const delta = event.clientX - swipe.startX; if (Math.abs(delta) > 34) setActiveCard((current) => Math.min(visibleNotes.length - 1, Math.max(0, current + (delta < 0 ? 1 : -1)))); suppressTapRef.current = true; window.setTimeout(() => { suppressTapRef.current = false; }, 0); }} onPointerCancel={() => { swipeRef.current = null; }}>{visibleNotes.map((note, index) => <button key={note.id} ref={(element) => { cardRefs.current[index] = element; }} className={`react-folder-paper bounce-card${index === activeCard ? " is-active" : ""}`} type="button" tabIndex={drawerOpen ? 0 : -1} onMouseEnter={() => pushCards(index)} onClick={() => openCard(note, index)} style={{ transform: drawerOpen ? cardTransforms[index] : "translate(-50%, 10%)", zIndex: 20 - Math.abs(index - activeCard) }} aria-label={`打开 ${localDate(note.delivered_at)} 收到的纸条`}><time dateTime={note.delivered_at}>{localDate(note.delivered_at)}</time></button>)}</div>
        <span className="react-folder-front" aria-hidden="true" />
        <span className="react-folder-front right" aria-hidden="true" />
        <button className="react-folder-toggle" type="button" onClick={toggleFolder} aria-expanded={drawerOpen} aria-controls="unread-folder-content" aria-label={drawerOpen ? "合上未读纸条文件夹" : "打开未读纸条文件夹"} />
      </div>
    </div>
  </section>;
}

function ReceivedFeed({ notes }: { notes: Note[] }) {
  const orderedNotes = useMemo(() => [...notes].sort((a, b) => new Date(a.delivered_at).getTime() - new Date(b.delivered_at).getTime()), [notes]);
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const positionRef = useRef(0);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const dragRef = useRef<{ id: number; startY: number; startPosition: number; lastY: number; lastTime: number; velocity: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const wheelLockRef = useRef(0);
  const [active, setActive] = useState(() => Math.max(0, orderedNotes.length - 1));

  const layout = useCallback((position: number) => {
    const root = rootRef.current;
    if (!root) return;
    const compact = root.clientWidth < 620;
    const spreadX = compact ? 46 : 90;
    const readingGap = compact ? 214 : 240;
    const stackGap = compact ? 37 : 44;
    cardRefs.current.forEach((card, index) => {
      if (!card) return;
      const distance = index - position;
      const distanceAbs = Math.abs(distance);
      const x = Math.sin(distance * .65) * spreadX;
      const y = Math.sign(distance) * (Math.min(1, distanceAbs) * readingGap + Math.max(0, distanceAbs - 1) * stackGap);
      const z = -distanceAbs * 8;
      const rotateY = Math.sin(distance * .65) * (compact ? -3 : -5);
      const rotateZ = Math.sin(distance * .65) * 2;
      const visible = distanceAbs < 7;
      const scale = Math.max(.26, Math.exp(-distanceAbs * .30));
      card.style.transform = `translate(-50%, -50%) translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) rotateY(${rotateY.toFixed(2)}deg) rotateZ(${rotateZ.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      card.style.opacity = visible ? String(Math.max(0, 1 - distanceAbs * 0.12)) : "0";
      card.style.filter = `saturate(${Math.max(0.42, 1 - distanceAbs * 0.13).toFixed(3)}) brightness(${Math.min(1.16, 1 + distanceAbs * 0.035).toFixed(3)}) blur(${Math.min(3.8, distanceAbs * 0.78).toFixed(2)}px)`;
      card.style.zIndex = String(100 - Math.round(distanceAbs * 5));
      card.style.pointerEvents = visible ? "auto" : "none";
      card.style.setProperty("--depth-tint", Math.min(0.48, distanceAbs * 0.14).toFixed(3));
    });
  }, []);

  const goTo = useCallback((next: number, animate = true) => {
    if (!orderedNotes.length) return;
    const target = Math.min(Math.max(next, 0), orderedNotes.length - 1);
    tweenRef.current?.kill();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const proxy = { value: positionRef.current };
    tweenRef.current = gsap.to(proxy, {
      value: target,
      duration: animate && !reduceMotion ? 0.28 : 0,
      ease: "power3.out",
      overwrite: true,
      onUpdate: () => { positionRef.current = proxy.value; layout(proxy.value); },
      onComplete: () => { positionRef.current = target; layout(target); },
    });
    setActive(target);
  }, [layout, orderedNotes.length]);

  useEffect(() => {
    cardRefs.current = cardRefs.current.slice(0, orderedNotes.length);
    const safeIndex = Math.min(active, Math.max(0, orderedNotes.length - 1));
    positionRef.current = safeIndex;
    setActive(safeIndex);
    layout(safeIndex);
  }, [active, layout, orderedNotes.length]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => layout(positionRef.current));
    observer.observe(root);
    return () => { observer.disconnect(); tweenRef.current?.kill(); };
  }, [layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || orderedNotes.length < 2) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (Math.abs(delta) < 10) return;
      const now = performance.now();
      if (now < wheelLockRef.current) return;
      wheelLockRef.current = now + 280;
      goTo(Math.round(positionRef.current) + (delta > 0 ? 1 : -1));
    };
    root.addEventListener("wheel", handleWheel, { passive: false });
    return () => root.removeEventListener("wheel", handleWheel);
  }, [goTo, orderedNotes.length]);

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (!drag.moved) return;
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    const projected = positionRef.current - drag.velocity * 210 / Math.max(150, (rootRef.current?.clientHeight ?? 520) * 0.36);
    goTo(Math.round(projected));
  }, [goTo]);

  return <section className="received-feed" aria-labelledby="received-title">
    <div className="section-heading"><h2 id="received-title">收到的纸条</h2><span>共 {notes.length} 条</span></div>
    {orderedNotes.length ? <div
      className="note-carousel"
      ref={rootRef}
      role="region"
      aria-roledescription="纸条轮播"
      aria-label="收到的纸条"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") { event.preventDefault(); goTo(active - 1, false); }
        if (event.key === "ArrowDown") { event.preventDefault(); goTo(active + 1, false); }
      }}
      onPointerDown={(event) => {
        if (dragRef.current) return;
        suppressClickRef.current = false;
        tweenRef.current?.kill();
        dragRef.current = { id: event.pointerId, startY: event.clientY, startPosition: positionRef.current, lastY: event.clientY, lastTime: performance.now(), velocity: 0, moved: false };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const delta = event.clientY - drag.startY;
        if (!drag.moved && Math.abs(delta) > 10) { drag.moved = true; event.currentTarget.setPointerCapture(drag.id); }
        if (!drag.moved) return;
        const now = performance.now();
        drag.velocity = (event.clientY - drag.lastY) / Math.max(1, now - drag.lastTime);
        drag.lastY = event.clientY;
        drag.lastTime = now;
        const step = Math.max(150, event.currentTarget.clientHeight * 0.36);
        const raw = drag.startPosition - delta / step;
        const min = raw < 0 ? raw * 0.24 : raw;
        const max = min > orderedNotes.length - 1 ? orderedNotes.length - 1 + (min - orderedNotes.length + 1) * 0.24 : min;
        positionRef.current = Math.min(orderedNotes.length - 0.72, Math.max(-0.72, max));
        layout(positionRef.current);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="note-carousel-stage">
        {orderedNotes.map((note, index) => <article
          className={`carousel-note carousel-note-${index % 4}`}
          key={note.id}
          ref={(element) => { cardRefs.current[index] = element; }}
          aria-hidden={active !== index}
          onClick={() => { if (!suppressClickRef.current && index !== active) goTo(index); }}
        >
          <span className="carousel-tape" aria-hidden="true" />
          <header><p>{localDate(note.delivered_at)} 收到</p><small className="date-text">写于 {localDate(note.created_at)}</small></header>
          <p className="carousel-note-body">{note.body}</p>
          <span className="carousel-depth-tint" aria-hidden="true" />
        </article>)}
      </div>
    </div> : <p className="empty-line">打开过的纸条会留在这里。</p>}
  </section>;
}

function Dashboard({ username, partner, timezone, partnerTimezone, client }: { username: string; partner: string; timezone: string; partnerTimezone: string; client: SupabaseClient | null }) {
  const [composeOpen, setComposeOpen] = useState(false), [activeNote, setActiveNote] = useState<Note | null>(null), [unread, setUnread] = useState<UnreadNote[]>([]), [received, setReceived] = useState<Note[]>([]), [pending, setPending] = useState(0), [loadError, setLoadError] = useState("");
  const [myTimezone, setMyTimezone] = useState(timezone);
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (activeNote) closeRef.current?.focus(); }, [activeNote]);
  useEffect(() => { setShowNotificationPrompt("Notification" in window && Notification.permission === "default"); }, []);
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
      const realUnread = (unreadResult.data ?? []) as UnreadNote[];
      setUnread(process.env.NODE_ENV === "development" && username === "斯斯" ? [...sisiMockNotes.map(({ id, delivered_at }) => ({ id, delivered_at })), ...realUnread] : realUnread);
      setReceived((receivedResult.data ?? []) as Note[]);
    }
    void load();
    return () => { cancelled = true; };
  }, [client]);
  async function openNote(note: UnreadNote) {
    const mockNote = process.env.NODE_ENV === "development" && username === "斯斯" ? sisiMockNotes.find((item) => item.id === note.id) : undefined;
    if (mockNote) {
      setUnread((items) => items.filter((item) => item.id !== note.id));
      setReceived((items) => [mockNote, ...items.filter((item) => item.id !== mockNote.id)]);
      setActiveNote(mockNote);
      return;
    }
    if (!client) return;
    setLoadError("");
    const { data, error } = await client.rpc("open_note", { note_id: note.id });
    const opened = Array.isArray(data) ? data[0] as Note | undefined : undefined;
    if (error || !opened) { setLoadError("这张纸条暂时打不开，请稍后再试。"); return; }
    setUnread((items) => items.filter((item) => item.id !== note.id));
    setReceived((items) => [opened, ...items.filter((item) => item.id !== opened.id)]);
    setActiveNote(opened);
  }
  async function enableNotifications() { if (!("Notification" in window)) return; const permission = await Notification.requestPermission(); setShowNotificationPrompt(false); if (permission !== "granted") alert("通知没有开启，可稍后在浏览器设置中更改。"); }
  return <main className="desk"><section className="paper" aria-label="我的纸条"><header className="masthead"><h1>纸条</h1><p>你和 <strong>{partner}</strong></p></header><aside className="summary"><p className="relationship">我们的小角落</p><h2>待发送纸条</h2><p className="pending-count"><span>{pending}</span> 条</p><button className="compose-tab" onClick={() => setComposeOpen(true)}><span>留一张纸条</span></button>{showNotificationPrompt && <div className="notification-note"><BellIcon /><div><p>打开提醒，新纸条到了就告诉你。</p><button className="text-button" onClick={enableNotifications}>去打开提醒</button><p className="ios-note">用 iPhone 的话，先在 Safari 里添加到主屏幕哦。</p></div></div>}</aside><div className="ledger">{loadError && <p className="dashboard-error" role="alert">{loadError}</p>}<UnreadDrawer notes={unread} open={(note) => void openNote(note)} /><ReceivedFeed notes={received} /></div><TimeZoneSettings client={client} initialTimezone={myTimezone} onSaved={setMyTimezone} /></section>{activeNote && <NoteDialog note={activeNote} close={() => setActiveNote(null)} closeRef={closeRef} />}{composeOpen && <ComposeDialog client={client} partner={partner} senderTimezone={myTimezone} partnerTimezone={partnerTimezone} close={() => setComposeOpen(false)} sealed={() => { setPending((value) => value + 1); setComposeOpen(false); }} />}</main>;
}

function TimeZoneSettings({ client, initialTimezone, onSaved }: { client: SupabaseClient | null; initialTimezone: string; onSaved: (timezone: string) => void }) {
  const [timezone, setTimezone] = useState(initialTimezone), [status, setStatus] = useState("");
  async function save() {
    if (!client) return;
    setStatus("正在保存…");
    const session = (await client.auth.getSession()).data.session;
    const { error } = session ? await client.from("profiles").update({ timezone }).eq("id", session.user.id) : { error: new Error("not_signed_in") };
    if (error) setStatus("没有保存成功，请稍后再试。");
    else { onSaved(timezone); setStatus("已保存，以后会按这个地区的时间接收纸条。"); }
  }
  return <section className="timezone-settings" aria-labelledby="timezone-settings-title"><div><h2 id="timezone-settings-title">我的所在地区</h2><p>当前时间：<span className="date-text">{timeInZone(timezone)}</span></p></div><TimeZoneField value={timezone} onChange={(value) => { setTimezone(value); setStatus(""); }} label="选择或更换所在地区" /><button type="button" className="timezone-save" onClick={() => void save()}>保存地区</button>{status && <p className="timezone-status" role="status">{status}</p>}</section>;
}

function NoteDialog({ note, close, closeRef }: { note: Note; close: () => void; closeRef: React.RefObject<HTMLButtonElement | null> }) { return <div className="modal-backdrop note-backdrop bounce-note-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}><section className="note-dialog bounce-note-dialog" role="dialog" aria-modal="true" aria-label="收到的纸条"><button ref={closeRef} className="close-button" onClick={close} aria-label="关闭">×</button><p className="dialog-body">{note.body}</p><dl className="dialog-dates"><div><dt>写下</dt><dd className="date-text">{localDateTime(note.created_at)}</dd></div><div><dt>送达</dt><dd className="date-text">{localDateTime(note.delivered_at)}</dd></div></dl></section></div>; }

function ComposeDialog({ client, partner, senderTimezone, partnerTimezone, close, sealed }: { client: SupabaseClient | null; partner: string; senderTimezone: string; partnerTimezone: string; close: () => void; sealed: () => void }) {
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
  const comparisonDate = basis === "date" ? new Date(`${date}T12:00:00Z`) : new Date(Date.now() + Math.max(0, Number(days) || 0) * 86400000);
  const hasTimeDifference = timeZoneOffset(senderTimezone, comparisonDate) !== timeZoneOffset(partnerTimezone, comparisonDate);
  return <div className="modal-backdrop"><section className="compose-dialog" role="dialog" aria-modal="true" aria-labelledby="compose-title"><button className="close-button" onClick={close} aria-label="关闭">×</button><h2 id="compose-title">留一张纸条</h2>{!confirming ? <form onSubmit={(event) => { event.preventDefault(); setConfirming(true); }}><label className="writing-field">正文<textarea required maxLength={2000} placeholder="写下想在未来抵达的话…" value={body} onChange={(event) => setBody(event.target.value)} /></label><fieldset><legend>什么时候抵达</legend><div className="mode-switch"><button type="button" aria-pressed={mode === "fixed"} onClick={() => setMode("fixed")}>按时间</button><button type="button" aria-pressed={mode === "random"} onClick={() => setMode("random")}>随机一天</button></div>{mode === "fixed" ? <div className="schedule-submenu"><p>按时间，可以这样选日期</p><div className="mode-switch schedule-basis"><button type="button" aria-pressed={basis === "days"} onClick={() => setBasis("days")}>按天数</button><button type="button" aria-pressed={basis === "date"} onClick={() => setBasis("date")}>选日期</button></div><div className="delivery-fields"><label><span>{basis === "days" ? "几天后" : "送达日期"}</span>{basis === "days" ? <input type="number" min="0" max="365" value={days} onChange={(event) => setDays(event.target.value)} required /> : <input type="date" min={new Date().toLocaleDateString("en-CA")} value={date} onChange={(event) => setDate(event.target.value)} required />}</label><label><span>在几点</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} required /></label></div>{hasTimeDifference && <><div className="partner-clock"><span>{partner} 当前时间</span><strong className="date-text">{timeInZone(partnerTimezone)}</strong><small>{timeZoneLabel(partnerTimezone)}</small></div><small className="timezone-hint">送达时间按照对方设置的所在地区计算。</small></>}</div> : <label className="random-field"><span>时间范围</span><select value={randomWindow} onChange={(event) => setRandomWindow(event.target.value)}><option value="3">3 天内随机</option><option value="7">7 天内随机</option><option value="14">14 天内随机</option><option value="30">30 天内随机</option></select><small>具体送达时间会立即锁定，但你们都不会看到。</small></label>}</fieldset><button className="seal-button">放进时间里</button></form> : <div className="confirm-seal"><p>送出以后，就不能再偷看、修改或收回啦。</p>{error && <p className="flow-error" role="alert">{error}</p>}<div><button className="text-button" onClick={() => setConfirming(false)} disabled={busy}>我再看看</button><button className="seal-button" onClick={() => void send()} disabled={busy}>{busy ? "正在送出…" : "好，送它出发"}</button></div></div>}</section></div>;
}

function BellIcon() { return <svg className="bell" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.8 10.3c0-3.4 1.7-5.5 5.2-5.5s5.2 2.1 5.2 5.5c0 4 1.7 5.2 2.3 6.1H4.5c.6-.9 2.3-2.1 2.3-6.1ZM9.8 19c.5.7 1.2 1.1 2.2 1.1s1.7-.4 2.2-1.1" /></svg>; }

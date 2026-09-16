"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { localDate } from "@/lib/dates";
import "./unread-folder.css";

type Unread = { id: string; delivered_at: string };

// React Bits BounceCards: scoped GSAP entrance, straightened hover and pushed siblings.
// Date buttons replace images; touch navigation extends the original mouse interaction.
export function UnreadFolder({ notes, open }: { notes: Unread[]; open: (note: Unread) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const gesture = useRef<{ id: number; x: number; y: number; delta: number; dragging: boolean } | null>(null);
  const ignoreClick = useRef(false);
  const opening = useRef(false);
  const previousOpen = useRef(false);
  const visible = notes.slice(0, 10);
  const count = visible.length;
  const current = Math.min(active, Math.max(0, count - 1));
  const windowSize = count;
  const windowStart = Math.max(0, Math.min(current - Math.floor(windowSize / 2), count - windowSize));
  const fanCenter = windowStart + (windowSize - 1) / 2;
  const inFan = (index: number) => index >= windowStart && index < windowStart + windowSize;
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function pose(index: number, hover = -1, drag = 0) {
    const distance = index - fanCenter;
    const width = stage.current?.clientWidth ?? 350;
    const step = Math.min(54, (width - 148) / Math.max(1, count - 1));
    const pushed = hover < 0 || hover === index ? 0 : index < hover ? -45 : 45;
    return { x: distance * step + pushed + drag, y: Math.min(40, Math.abs(distance) * 10), rotation: hover === index ? 0 : Math.max(-22, Math.min(22, distance * 7)), scale: hover === index ? 1.06 : Math.max(.78, 1 - Math.abs(distance) * .055) };
  }

  function arrange(hover = -1, drag = 0, instant = false) {
    cards.current.slice(0, count).forEach((card, index) => {
      if (!card) return;
      card.style.zIndex = String(hover === index ? 40 : 20 - Math.abs(index - current));
      card.style.pointerEvents = inFan(index) ? "auto" : "none";
      gsap.to(card, { ...pose(index, hover, drag), opacity: inFan(index) ? 1 : 0, duration: instant || reduced() ? 0 : .28, ease: "back.out(1.4)", overwrite: true });
    });
  }

  useEffect(() => {
    const entering = expanded && !previousOpen.current;
    previousOpen.current = expanded;
    const context = gsap.context(() => {
      cards.current.slice(0, count).forEach((card, index) => {
        if (!card) return;
        gsap.killTweensOf(card);
        card.style.zIndex = String(20 - Math.abs(index - current));
        card.style.pointerEvents = expanded && inFan(index) ? "auto" : "none";
        const target = expanded ? { ...pose(index), opacity: inFan(index) ? 1 : 0 } : { x: 0, y: 170, rotation: 0, scale: .94, opacity: 0 };
        if (entering && !reduced()) gsap.fromTo(card, { x: 0, y: 170, rotation: 0, scale: .94, opacity: 0 }, { ...target, duration: .5, delay: Math.min(index * .045, .18), ease: "elastic.out(1, 0.8)", overwrite: true });
        else gsap.to(card, { ...target, duration: reduced() ? 0 : .28, ease: "back.out(1.4)", overwrite: true });
      });
    }, stage);
    return () => context.revert();
  }, [expanded, current, count]);

  function select(note: Unread, index: number) {
    if (ignoreClick.current || opening.current) return;
    const card = cards.current[index];
    if (!card) return;
    opening.current = true;
    card.style.zIndex = "50";
    gsap.to(card, { x: 0, y: -12, rotation: 0, scale: 1.18, duration: reduced() ? 0 : .2, overwrite: true, ease: "power3.out", onComplete: () => { open(note); opening.current = false; } });
  }

  return <section className="uf-section" aria-labelledby="unread-title" data-open={expanded}>
    <div className="folder-heading"><div><h2 id="unread-title">未读纸条</h2><p>{notes.length ? `有${notes.length}张没看过的纸条` : "暂时空空的"}</p></div></div>
    <div className="uf-expander"><div className="uf-clip">
      <div className="uf-stage" ref={stage} aria-hidden={!expanded}
        onPointerDown={(event) => { if (!expanded || gesture.current) return; ignoreClick.current = false; gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, delta: 0, dragging: false }; }}
        onPointerMove={(event) => { const g = gesture.current; if (!g || g.id !== event.pointerId) return; const dx = event.clientX - g.x; if (!g.dragging && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(event.clientY - g.y)) { g.dragging = true; event.currentTarget.setPointerCapture(event.pointerId); } if (g.dragging) { g.delta = dx; ignoreClick.current = true; arrange(-1, dx * .65, true); } }}
        onPointerUp={() => { const g = gesture.current; gesture.current = null; if (!g?.dragging) return; if (Math.abs(g.delta) > 30) setActive(Math.max(0, Math.min(count - 1, current + (g.delta < 0 ? 1 : -1)))); arrange(); }}
        onPointerCancel={() => { gesture.current = null; arrange(); }}
        onPointerLeave={(event) => { if (event.pointerType === "mouse" && !gesture.current) arrange(); }}>
        {visible.map((note, index) => <button key={note.id} ref={(el) => { cards.current[index] = el; }} className="uf-card" tabIndex={expanded ? 0 : -1} aria-label={`打开 ${localDate(note.delivered_at)} 收到的纸条`} onPointerEnter={(event) => { if (expanded && event.pointerType === "mouse" && !gesture.current) arrange(index); }} onClick={() => select(note, index)} onKeyDown={(event) => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); setActive(Math.max(0, Math.min(count - 1, current + (event.key === "ArrowRight" ? 1 : -1)))); } }}><time dateTime={note.delivered_at}>{localDate(note.delivered_at)}</time></button>)}
        {!count && <p className="uf-empty">新纸条来了，会放在这里。</p>}
      </div>
    </div></div>
    <button className="uf-folder" aria-label={expanded ? "合上未读纸条文件夹" : "打开未读纸条文件夹"} aria-expanded={expanded} onClick={() => { setExpanded(!expanded); ignoreClick.current = false; }}><span className="uf-back" /><span className="uf-front" /><span className="uf-front uf-right" /></button>
  </section>;
}

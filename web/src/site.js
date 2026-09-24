/*
 * ArmBar landing page - scroll animations.
 *
 *  - GSAP ScrollTrigger: 3D entrances for headings, tiles, cards and the route,
 *    a pinned horizontal 3D carousel for the five business questions, and
 *    parallax on the photos.
 *  - Lenis: smooth, inertial scrolling.
 *
 * Build:  npx esbuild web/src/site.js --bundle --minify --format=iife --outfile=web/js/site.js
 */
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger);

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const isTouch = matchMedia("(pointer: coarse)").matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

/* ================================================================== smooth scroll */
let lenis = null;
if (!reduceMotion) {
  lenis = new Lenis({
    duration: 1.5,                                           // one wheel notch glides for ~1.5s
    easing: (t) => 1 - Math.pow(1 - t, 4),                   // ease-out
    wheelMultiplier: 0.85, touchMultiplier: 1.4, smoothWheel: true,
  });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  $$('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => {
    const id = a.getAttribute("href");
    const el = id === "#top" ? 0 : $(id);
    if (el !== null) { e.preventDefault(); lenis.scrollTo(el, { offset: 0, duration: 1.6 }); }
  }));
}

/* ================================================================== scroll choreography */
function initMotion() {
  const nav = $("#nav"), progress = $("#progress");
  ScrollTrigger.create({
    start: 0, end: "max",
    onUpdate: (self) => { gsap.set(progress, { scaleX: self.progress }); nav.classList.toggle("scrolled", self.scroll() > 40); },
  });
  if (reduceMotion) return;

  // hero intro
  const intro = gsap.timeline({ delay: 0.2 });
  intro.from("#heroTitle .line > span", { yPercent: 115, duration: 1.2, ease: "power4.out", stagger: 0.12 })
       .from(".hero .fade-up", { y: 40, opacity: 0, duration: 0.9, ease: "power3.out", stagger: 0.1 }, "-=0.7");

  // hero tilts back into the distance as you leave it
  gsap.to(".hero .content", {
    y: -90, opacity: 0, ease: "none",
    scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom 20%", scrub: 1.2 },
  });
  gsap.to(".hero .bg", { yPercent: 18, scale: 1.06, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: 1.2 } });

  // headings wipe up from a mask (no 3D tilt, so no distortion mid-animation)
  $$(".flip").forEach((h) => gsap.fromTo(h,
    { clipPath: "inset(0 0 100% 0)", y: 40 },
    { clipPath: "inset(0 0 0% 0)", y: 0, duration: 1.1, ease: "power4.out",
      scrollTrigger: { trigger: h, start: "top 88%", toggleActions: "play none none reverse" } }));
  $$("section .fade-up").forEach((el) => gsap.from(el, {
    y: 50, opacity: 0, duration: 0.9, ease: "power3.out",
    scrollTrigger: { trigger: el, start: "top 92%", toggleActions: "play none none reverse" },
  }));

  // tiles swing in like cards, photos parallax inside
  const tiles = $$(".tile"), angles = [-58, -26, 26, 58];
  tiles.forEach((tile, i) => {
    gsap.fromTo(tile,
      { rotateY: angles[i % 4], rotateX: 32, z: -520, y: 200, opacity: 0 },
      { rotateY: 0, rotateX: 0, z: 0, y: 0, opacity: 1, ease: "none",
        scrollTrigger: { trigger: ".tiles", start: "top 105%", end: "top 30%", scrub: 1.2 } });
    gsap.fromTo(tile.querySelector(".ph"), { yPercent: -6 }, { yPercent: 6, ease: "none",
      scrollTrigger: { trigger: tile, start: "top bottom", end: "bottom top", scrub: 1.2 } });
  });

  // business-unit cards: one clean, time-based reveal (not tied to scroll position)
  gsap.set(".unit", { clipPath: "inset(0 100% 0 0)", y: 30 });
  gsap.set(".unit h3, .unit p", { opacity: 0, y: 14 });
  ScrollTrigger.create({
    trigger: ".units", start: "top 80%", once: true,
    onEnter: () => {
      const tl = gsap.timeline();
      tl.to(".unit", { clipPath: "inset(0 0% 0 0)", y: 0, duration: 1.0, ease: "power4.out", stagger: 0.18 })
        .to(".unit h3, .unit p", { opacity: 1, y: 0, duration: 0.7, ease: "power3.out", stagger: 0.08 }, 0.35);
    },
  });

  const mm = gsap.matchMedia();
  // desktop: pinned horizontal track. Cards stay flat and only the track moves (GPU transform),
  // the card nearest the centre is highlighted - computed from progress, no layout measuring.
  mm.add("(min-width: 961px)", () => {
    const track = $("#track"), cards = $$(".qcard");
    let step = 0, active = -1;
    const measure = () => { step = cards[1].offsetLeft - cards[0].offsetLeft; };
    const dist = () => track.scrollWidth - innerWidth;
    const setActive = (x) => {
      const i = clamp(Math.round(-x / step), 0, cards.length - 1);
      if (i !== active) { cards.forEach((c, k) => c.classList.toggle("is-active", k === i)); active = i; }
    };
    measure(); setActive(0);
    const tw = gsap.to(track, {
      x: () => -dist(), ease: "none", force3D: true,
      onUpdate: () => setActive(gsap.getProperty(track, "x")),
      scrollTrigger: { trigger: ".qs", start: "top top", end: () => "+=" + dist() * 1.1, pin: true, scrub: 0.8,
                       anticipatePin: 1, invalidateOnRefresh: true, onRefresh: measure },
    });
    return () => { tw.kill(); cards.forEach((c) => c.classList.remove("is-active")); };
  });
  mm.add("(max-width: 960px)", () => {
    $$(".qcard").forEach((c) => gsap.from(c, { y: 50, opacity: 0, duration: 0.8, ease: "power3.out",
      scrollTrigger: { trigger: c, start: "top 92%", toggleActions: "play none none reverse" } }));
  });

  // branch route draws itself, stops pop up
  const narrow = () => innerWidth <= 960;
  gsap.fromTo(".route .rail i", { scaleX: 0, scaleY: 1 }, {
    scaleX: 1, ease: "none", scrollTrigger: { trigger: "#route", start: "top 85%", end: "top 35%", scrub: 1.2 },
  });
  gsap.from(".stop", {
    y: 30, opacity: 0, stagger: 0.18, ease: "none",
    scrollTrigger: { trigger: "#route", start: "top 85%", end: "top 35%", scrub: 1.2 },
  });
  if (narrow()) gsap.set(".route .rail i", { transformOrigin: "50% 0%" });

  // final title rushes in from depth
  gsap.fromTo("#finalTitle", { scale: 1.35, opacity: 0 },
    { scale: 1, opacity: 1, ease: "none", scrollTrigger: { trigger: ".final", start: "top 90%", end: "center 60%", scrub: 1.2 } });
  gsap.fromTo(".final .bg", { scale: 1.25 }, { scale: 1, ease: "none", scrollTrigger: { trigger: ".final", start: "top bottom", end: "bottom bottom", scrub: 1.2 } });

  // hover: tiles lean toward the cursor (inner photo layer, so it doesn't fight the scroll animation)
  if (!isTouch) tiles.forEach((tile) => {
    const ph = tile.querySelector(".ph"), txt = tile.querySelector(".t");
    const rx = gsap.quickTo(ph, "x", { duration: 0.6, ease: "power3" }), ry = gsap.quickTo(ph, "y", { duration: 0.6, ease: "power3" });
    const tx = gsap.quickTo(txt, "x", { duration: 0.6, ease: "power3" }), ty = gsap.quickTo(txt, "y", { duration: 0.6, ease: "power3" });
    tile.addEventListener("pointermove", (e) => {
      const r = tile.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      rx(-x * 24); ry(-y * 24); tx(x * 10); ty(y * 10);
    });
    tile.addEventListener("pointerleave", () => { rx(0); ry(0); tx(0); ty(0); });
  });
}

/* ================================================================== boot */
function boot() {
  initMotion();
  requestAnimationFrame(() => ScrollTrigger.refresh());
}
if (document.fonts && document.fonts.ready) document.fonts.ready.then(boot); else addEventListener("load", boot);

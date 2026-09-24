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
  intro.from("#heroTitle .line > span", { yPercent: 120, rotateX: -80, opacity: 0, duration: 1.2, ease: "power4.out", stagger: 0.12, transformPerspective: 700 })
       .from(".hero .fade-up", { y: 40, opacity: 0, duration: 0.9, ease: "power3.out", stagger: 0.1 }, "-=0.7");

  // hero tilts back into the distance as you leave it
  gsap.to(".hero .content", {
    y: -90, opacity: 0, ease: "none",
    scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom 20%", scrub: 1.2 },
  });
  gsap.to(".hero .bg", { yPercent: 18, scale: 1.06, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: 1.2 } });

  // headings flip up in 3D
  $$(".flip").forEach((h) => gsap.from(h, {
    rotateX: -95, y: 70, opacity: 0, transformOrigin: "50% 100%", transformPerspective: 800, duration: 1.1, ease: "power3.out",
    scrollTrigger: { trigger: h, start: "top 88%", toggleActions: "play none none reverse" },
  }));
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

  // business-unit cards come out of the depth
  gsap.from(".unit", {
    x: 120, rotateY: -45, z: -200, opacity: 0, transformPerspective: 900, stagger: 0.15, ease: "none",
    scrollTrigger: { trigger: ".units", start: "top 95%", end: "top 55%", scrub: 1.2 },
  });

  const mm = gsap.matchMedia();
  // desktop: pinned horizontal 3D carousel of the five questions
  mm.add("(min-width: 961px)", () => {
    const track = $("#track"), cards = $$(".qcard");
    const dist = () => track.scrollWidth - innerWidth;
    const coverflow = () => {
      const mid = innerWidth / 2;
      cards.forEach((c) => {
        const r = c.getBoundingClientRect(), off = (r.left + r.width / 2 - mid) / innerWidth;
        gsap.set(c, { rotateY: clamp(-off * 70, -55, 55), z: -Math.abs(off) * 420,
                      opacity: clamp(1.2 - Math.abs(off) * 0.9, 0.45, 1) });
      });
    };
    const tw = gsap.to(track, {
      x: () => -dist(), ease: "none", onUpdate: coverflow,
      scrollTrigger: { trigger: ".qs", start: "top top", end: () => "+=" + dist(), pin: true, scrub: 1.2, invalidateOnRefresh: true, onRefresh: coverflow },
    });
    coverflow();
    return () => tw.kill();
  });
  mm.add("(max-width: 960px)", () => {
    $$(".qcard").forEach((c) => gsap.from(c, { rotateX: -50, y: 60, opacity: 0, transformPerspective: 800, duration: 0.9, ease: "power3.out",
      scrollTrigger: { trigger: c, start: "top 92%", toggleActions: "play none none reverse" } }));
  });

  // branch route draws itself, stops pop up
  const narrow = () => innerWidth <= 960;
  gsap.fromTo(".route .rail i", { scaleX: 0, scaleY: 1 }, {
    scaleX: 1, ease: "none", scrollTrigger: { trigger: "#route", start: "top 85%", end: "top 35%", scrub: 1.2 },
  });
  gsap.from(".stop", {
    scale: 0.4, rotateX: -90, y: 30, opacity: 0, transformPerspective: 700, stagger: 0.18, ease: "none",
    scrollTrigger: { trigger: "#route", start: "top 85%", end: "top 35%", scrub: 1.2 },
  });
  if (narrow()) gsap.set(".route .rail i", { transformOrigin: "50% 0%" });

  // final title rushes in from depth
  gsap.fromTo("#finalTitle", { scale: 2.2, opacity: 0, rotateX: 25, transformPerspective: 900 },
    { scale: 1, opacity: 1, rotateX: 0, ease: "none", scrollTrigger: { trigger: ".final", start: "top 90%", end: "center 60%", scrub: 1.2 } });
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

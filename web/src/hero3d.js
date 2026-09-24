/*
 * ArmBar landing page - 3D layer (Three.js)
 *
 * The photos are turned into real 3D surfaces using depth maps that were
 * estimated with a computer-vision model (MiDaS v2.1 small, monocular depth
 * estimation) - see pipeline/depth_maps.py. Each pixel is pushed toward the
 * camera by its estimated depth, so moving the camera gives true parallax,
 * and a red "spotlight" follows the pointer and lights the surface using
 * normals derived from the same depth map.
 *
 * Source file: web/src/hero3d.js  ->  bundled to web/js/hero3d.js (see README).
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, PlaneGeometry, ShaderMaterial, Mesh,
  TextureLoader, SRGBColorSpace, LinearFilter, Vector2, Vector3, BufferGeometry,
  Float32BufferAttribute, Points, AdditiveBlending, Color,
} from "three";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = matchMedia("(pointer: coarse)").matches;

function webglOK() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch (_) { return false; }
}

/* ------------------------------------------------------------------ shaders */
const vert = /* glsl */ `
  uniform sampler2D uDepth;
  uniform float uAmp;
  varying vec2 vUv;
  varying float vD;
  void main() {
    vUv = uv;
    float d = texture2D(uDepth, uv).r;
    vD = d;
    vec3 p = position;
    p.z += d * uAmp;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const frag = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uDepth;
  uniform vec2 uTexel;
  uniform vec2 uLight;      // pointer position in uv space
  uniform float uLightOn;   // 0..1 fade
  uniform float uBright;
  uniform float uGray;
  uniform vec3 uRed;
  varying vec2 vUv;
  varying float vD;

  void main() {
    vec3 col = texture2D(uMap, vUv).rgb;
    float g = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(g), uGray);
    col = (col - 0.5) * 1.12 + 0.5;                 // a touch of contrast

    // surface normal from the depth map (central differences)
    float dx = texture2D(uDepth, vUv + vec2(uTexel.x, 0.0)).r - texture2D(uDepth, vUv - vec2(uTexel.x, 0.0)).r;
    float dy = texture2D(uDepth, vUv + vec2(0.0, uTexel.y)).r - texture2D(uDepth, vUv - vec2(0.0, uTexel.y)).r;
    vec3 n = normalize(vec3(-dx * 6.0, -dy * 6.0, 1.0));

    // red spotlight that follows the pointer, placed in front of the surface
    vec3 lp = vec3(uLight, 0.55);
    vec3 sp = vec3(vUv, vD * 0.35);
    vec3 L = normalize(lp - sp);
    float dist = distance(uLight, vUv);
    float fall = smoothstep(0.34, 0.0, dist);
    float diff = max(dot(n, L), 0.0);
    float rim = pow(1.0 - max(n.z, 0.0), 1.5);

    col *= uBright * (0.75 + 0.45 * vD);            // nearer = slightly brighter
    col += uRed * (diff * fall * 0.38 + rim * fall * 0.75) * uLightOn * (0.25 + vD * vD);

    // vignette
    vec2 q = vUv - 0.5;
    col *= smoothstep(0.95, 0.25, length(q * vec2(1.1, 1.3)));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ scene factory */
function depthScene({ canvas, host, image, depth, aspect, amp = 0.55, gray = 1, bright = 0.62,
                      segments = 220, dust = true, sway = 1, scrollDolly = true }) {
  const renderer = new WebGLRenderer({ canvas, antialias: !coarse, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x0a0a0a, 1);

  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.1, 50);
  const loader = new TextureLoader();
  const pointer = new Vector2(0, 0), target = new Vector2(0, 0);
  const light = new Vector2(0.62, 0.5), lightTarget = new Vector2(0.62, 0.5);
  let lightOn = 0, lightOnTarget = coarse ? 0.7 : 0;
  let scrollP = 0, visible = true, running = false, mesh, dustPts;
  const t0 = performance.now();

  const segs = coarse ? Math.round(segments * 0.6) : segments;
  const geo = new PlaneGeometry(aspect, 1, Math.round(segs * aspect), segs);

  return Promise.all([loader.loadAsync(image), loader.loadAsync(depth)]).then(([map, dmap]) => {
    map.colorSpace = SRGBColorSpace;
    [map, dmap].forEach((t) => { t.minFilter = LinearFilter; t.generateMipmaps = false; });
    const mat = new ShaderMaterial({
      vertexShader: vert, fragmentShader: frag,
      uniforms: {
        uMap: { value: map }, uDepth: { value: dmap }, uAmp: { value: amp },
        uTexel: { value: new Vector2(1 / dmap.image.width, 1 / dmap.image.height) },
        uLight: { value: light }, uLightOn: { value: 0 }, uBright: { value: bright },
        uGray: { value: gray }, uRed: { value: new Color(0xe0182d) },
      },
    });
    mesh = new Mesh(geo, mat);
    scene.add(mesh);

    if (dust) {                                     // floating chalk dust, for depth cues
      const n = coarse ? 180 : 420, pos = [];
      for (let i = 0; i < n; i++) pos.push((Math.random() - 0.5) * aspect * 1.4, (Math.random() - 0.5) * 1.4, Math.random() * 1.6);
      const g = new BufferGeometry();
      g.setAttribute("position", new Float32BufferAttribute(pos, 3));
      dustPts = new Points(g, new ShaderMaterial({
        transparent: true, depthWrite: false, blending: AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uScale: { value: renderer.getPixelRatio() } },
        vertexShader: `uniform float uTime; uniform float uScale; varying float vA;
          void main(){ vec3 p = position; p.y += mod(uTime*0.02 + p.z*0.3, 1.4) - 0.7; p.x += sin(uTime*0.3 + p.z*6.0)*0.02;
            vec4 mv = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mv;
            gl_PointSize = (2.2 * uScale) * (3.0 / -mv.z); vA = 0.25 + 0.5 * fract(p.z*7.0); }`,
        fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord-0.5); if(d>0.5) discard;
            gl_FragColor = vec4(vec3(1.0), (0.5-d) * vA); }`,
      }));
      scene.add(dustPts);
    }

    function resize() {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // distance so the plane covers the view ("object-fit: cover") with room for parallax
      const vFov = camera.fov * Math.PI / 180, margin = 1.1;
      const distH = (1 / margin) / (2 * Math.tan(vFov / 2));
      const distW = (aspect / margin) / (2 * Math.tan(vFov / 2) * camera.aspect);
      camera.userData.base = Math.min(distH, distW) + amp * 0.2;
      camera.updateProjectionMatrix();
    }
    resize();
    new ResizeObserver(resize).observe(host);

    if (!coarse) {
      host.addEventListener("pointermove", (e) => {
        const r = host.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        target.set(x * 2 - 1, -(y * 2 - 1));
        lightTarget.set(x, 1 - y);
        lightOnTarget = 1;
      });
      host.addEventListener("pointerleave", () => { target.set(0, 0); lightOnTarget = 0; });
    }
    if (scrollDolly) {
      const onScroll = () => {
        const r = host.getBoundingClientRect();
        scrollP = Math.min(Math.max(-r.top / r.height, 0), 1);
      };
      addEventListener("scroll", onScroll, { passive: true }); onScroll();
    }
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) start(); }, { threshold: 0 }).observe(host);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) start(); });

    const look = new Vector3(0, 0, amp * 0.35);
    function frame() {
      if (!visible || document.hidden) { running = false; return; }
      const t = (performance.now() - t0) / 1000;
      if (coarse || reduceMotion) {                 // gentle automatic sway on touch screens
        target.set(Math.sin(t * 0.35) * 0.6 * sway, Math.cos(t * 0.27) * 0.35 * sway);
        lightTarget.set(0.5 + Math.sin(t * 0.35) * 0.3, 0.5 + Math.cos(t * 0.27) * 0.2);
      }
      pointer.lerp(target, 0.05);
      light.lerp(lightTarget, 0.08);
      lightOn += (lightOnTarget - lightOn) * 0.06;
      mesh.material.uniforms.uLightOn.value = lightOn;

      const base = camera.userData.base;
      camera.position.set(pointer.x * 0.16 * sway, pointer.y * 0.1 * sway, base - scrollP * base * 0.28);
      camera.lookAt(look);
      mesh.rotation.x = -scrollP * 0.18;
      if (dustPts) dustPts.material.uniforms.uTime.value = t;

      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }
    function start() { if (!running && visible) { running = true; requestAnimationFrame(frame); } }
    start();
    return { renderer };
  });
}

/* ------------------------------------------------------------------ boot */
if (webglOK()) {
  const hero = document.querySelector(".hero");
  const heroCanvas = document.getElementById("heroCanvas");
  if (hero && heroCanvas) {
    depthScene({ canvas: heroCanvas, host: hero, image: "imgs/img2.webp", depth: "imgs/img2-depth.webp",
                 aspect: 4 / 3, amp: 0.34, sway: reduceMotion ? 0 : 1 })
      .then(() => hero.classList.add("is-3d"))
      .catch(() => {});                              // photo background stays as the fallback
  }
  const final = document.querySelector(".final");
  const finalCanvas = document.getElementById("finalCanvas");
  if (final && finalCanvas) {
    depthScene({ canvas: finalCanvas, host: final, image: "imgs/img1.webp", depth: "imgs/img1-depth.webp",
                 aspect: 1770 / 1180, amp: 0.45, bright: 0.5, dust: false, scrollDolly: false,
                 segments: 140, sway: reduceMotion ? 0 : 1 })
      .then(() => final.classList.add("is-3d"))
      .catch(() => {});
  }
}

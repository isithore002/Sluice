"use client";

import { useEffect, useRef, useState } from "react";
import { BOLT, BOLT_SCALE, LogoMark } from "./LogoMark";

/**
 * The mark as a real 3D object: a gradient ring around a dark disc with an extruded bolt, lit by an
 * environment map, glowing through a bloom pass. Three small nodes orbit it (Base, Lasna, Unichain) and a
 * pulse leaves it every few seconds (event -> reaction). Follows the pointer; a click spins it.
 *
 * three.js is imported lazily so it stays out of the first bundle. If WebGL is unavailable the flat SVG mark is shown.
 */
export function Logo3D() {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dead = false;
    let stop = () => {};
    start(el)
      .then((s) => (dead ? s() : (stop = s)))
      .catch(() => setFailed(true));
    return () => {
      dead = true;
      stop();
    };
  }, []);

  return (
    <div ref={host} className="logo3d" role="img" aria-label="Reactive logo: a lightning bolt inside a gradient ring">
      {failed && <LogoMark size={260} className="logo3d-fallback" />}
    </div>
  );
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function start(host: HTMLElement): Promise<() => void> {
  const [THREE, { RoomEnvironment }, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
    import("three"),
    import("three/examples/jsm/environments/RoomEnvironment.js"),
    import("three/examples/jsm/postprocessing/EffectComposer.js"),
    import("three/examples/jsm/postprocessing/RenderPass.js"),
    import("three/examples/jsm/postprocessing/UnrealBloomPass.js"),
    import("three/examples/jsm/postprocessing/OutputPass.js"),
  ]);

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Opaque black clear colour: the canvas is blended onto the glyph background with CSS `mix-blend-mode: screen`,
  // which lets the bloom pass glow over the background without needing a transparent framebuffer.
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.style.cssText = "display:block;width:100%;height:100%";
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = 0.4;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  camera.position.set(0, 0, 6.3);

  // Lights: a cool key from the upper left, a violet kicker from the lower right (the logo's two gradient ends).
  const keyLight = new THREE.PointLight(0x58a6ff, 24, 14, 2);
  keyLight.position.set(-2.6, 2.4, 3.4);
  const kickLight = new THREE.PointLight(0xa070ff, 20, 14, 2);
  kickLight.position.set(2.8, -2, 3);
  scene.add(keyLight, kickLight);

  const logo = new THREE.Group();
  scene.add(logo);

  // Ring: torus whose vertex colours run blue -> violet around the circle, with a cyan highlight at the top left.
  const ringGeo = new THREE.TorusGeometry(1, 0.15, 64, 160);
  {
    const pos = ringGeo.attributes.position;
    const colours = new Float32Array(pos.count * 3);
    const blue = new THREE.Color("#3d8bff");
    const violet = new THREE.Color("#8f5bff");
    const cyan = new THREE.Color("#35d0ff");
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getY(i), pos.getX(i));
      c.copy(blue).lerp(violet, 0.5 + 0.5 * Math.sin(a - 0.6));
      const hi = Math.max(0, Math.cos(a - 2.4));
      c.lerp(cyan, hi * hi * 0.4);
      colours.set([c.r, c.g, c.b], i * 3);
    }
    ringGeo.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  }
  const ring = new THREE.Mesh(
    ringGeo,
    new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      metalness: 0.2,
      roughness: 0.35,
      clearcoat: 0.5,
      clearcoatRoughness: 0.2,
      envMapIntensity: 0.55,
      emissive: new THREE.Color("#2c4dff"),
      emissiveIntensity: 0.45,
    }),
  );
  logo.add(ring);

  // Disc behind the bolt, with a thin bright inner edge like the flat logo.
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 0.14, 96),
    new THREE.MeshPhysicalMaterial({ color: 0x05060c, metalness: 0.1, roughness: 0.6, clearcoat: 0.25, clearcoatRoughness: 0.4 }),
  );
  disc.rotation.x = Math.PI / 2;
  logo.add(disc);
  const edge = new THREE.Mesh(
    new THREE.TorusGeometry(0.9, 0.012, 12, 160),
    new THREE.MeshBasicMaterial({ color: new THREE.Color("#5a8dff").multiplyScalar(1.6) }),
  );
  edge.position.z = 0.07;
  logo.add(edge);

  // Bolt: extruded outline with a soft bevel, white with a blue glow.
  const shape = new THREE.Shape();
  BOLT.forEach(([x, y], i) => (i ? shape.lineTo(x * BOLT_SCALE, y * BOLT_SCALE) : shape.moveTo(x * BOLT_SCALE, y * BOLT_SCALE)));
  shape.closePath();
  const boltGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.1,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.03,
    bevelSegments: 5,
    curveSegments: 1,
  });
  boltGeo.center();
  const bolt = new THREE.Mesh(
    boltGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.05, emissive: new THREE.Color("#8fbaff"), emissiveIntensity: 0.55 }),
  );
  bolt.position.z = 0.14;
  logo.add(bolt);

  // Pulse: a thin ring that leaves the logo every few seconds.
  const pulse = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.006, 8, 200),
    new THREE.MeshBasicMaterial({ color: new THREE.Color("#6ea8ff").multiplyScalar(1.8), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  logo.add(pulse);

  // Orbit with one node per chain, coloured like the chain chips.
  const orbit = new THREE.Group();
  orbit.rotation.x = 1.15;
  logo.add(orbit);
  orbit.add(
    new THREE.Mesh(
      new THREE.TorusGeometry(1.55, 0.006, 8, 220),
      new THREE.MeshBasicMaterial({ color: 0x4a5a8a, transparent: true, opacity: 0.55 }),
    ),
  );
  const nodes = [
    { colour: "#3b82f6", speed: 0.55, offset: 0 }, // Base Sepolia
    { colour: "#8b5cf6", speed: 0.55, offset: (Math.PI * 2) / 3 }, // Reactive Lasna
    { colour: "#ec4899", speed: 0.55, offset: (Math.PI * 4) / 3 }, // Unichain Sepolia
  ].map((n) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.065, 24, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(n.colour).multiplyScalar(2.2) }));
    orbit.add(m);
    return { ...n, mesh: m };
  });

  // A few hundred faint particles in a shell around the logo, for depth.
  const N = 260;
  const pts = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 2.4 + Math.random() * 1.8;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pts.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)], i * 3);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ color: 0x8fb4ff, size: 0.03, sizeAttenuation: true, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  scene.add(dust);

  // Post-processing: multisampled render target -> bloom -> tone mapping and colour space.
  const target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.45, 0.35, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    // Pull the camera back in tall containers so the logo is never cropped horizontally.
    camera.position.z = 6.3 / Math.min(1, camera.aspect);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  // Input: the logo leans toward the pointer; a click spins it once.
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (e: PointerEvent) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  };
  let spinStart = -10;
  const onDown = () => {
    spinStart = performance.now() / 1000;
  };
  if (!reduce) {
    window.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerdown", onDown);
  }

  let visible = true;
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  io.observe(host);

  const t0 = performance.now() / 1000;
  let last = t0;
  let raf = 0;
  const render = (now: number) => {
    const t = now - t0;
    const dt = Math.min(0.05, now - last);
    last = now;
    const intro = reduce ? 1 : easeOutCubic(Math.min(1, t / 1.8));

    const k = 1 - Math.exp(-dt * 4);
    pointer.x += (pointer.tx - pointer.x) * k;
    pointer.y += (pointer.ty - pointer.y) * k;

    const sp = Math.min(1, (now - spinStart) / 1.4);
    const spin = sp < 1 ? easeInOutCubic(sp) * Math.PI * 2 : 0;

    logo.scale.setScalar(0.55 + 0.45 * intro);
    logo.rotation.y = pointer.x * 0.45 + (reduce ? 0 : Math.sin(t * 0.45) * 0.28) + spin - (1 - intro) * 1.3;
    logo.rotation.x = pointer.y * 0.3 + (reduce ? 0 : Math.sin(t * 0.6) * 0.04);
    logo.position.y = reduce ? 0 : Math.sin(t * 1.1) * 0.06;
    bloom.strength = 0.45 * intro;

    const p = (t % 3.4) / 3.4;
    pulse.scale.setScalar(1 + p * 0.68); // stays inside the frame, so it never looks cropped
    (pulse.material as import("three").MeshBasicMaterial).opacity = reduce ? 0 : Math.pow(1 - p, 1.6) * 0.5 * intro;

    orbit.rotation.z = t * 0.12;
    for (const n of nodes) {
      const a = t * n.speed + n.offset;
      n.mesh.position.set(Math.cos(a) * 1.55, Math.sin(a) * 1.55, 0);
    }
    dust.rotation.y = t * 0.03;
    dust.rotation.x = t * 0.012;

    composer.render();
  };
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (visible) render(performance.now() / 1000);
  };
  if (reduce) {
    render(t0 + 2);
    const redraw = () => render(t0 + 2);
    ro.disconnect();
    const ro2 = new ResizeObserver(() => {
      resize();
      redraw();
    });
    ro2.observe(host);
    return () => {
      ro2.disconnect();
      io.disconnect();
      dispose();
    };
  }
  loop();

  function dispose() {
    scene.traverse((o) => {
      const m = o as import("three").Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as import("three").Material | import("three").Material[] | undefined;
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose());
    });
    envTexture.dispose();
    pmrem.dispose();
    target.dispose();
    composer.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    window.removeEventListener("pointermove", onMove);
    host.removeEventListener("pointerdown", onDown);
    dispose();
  };
}

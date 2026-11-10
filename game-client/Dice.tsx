import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { DICE_FACES, diceOrientation, topFace } from "./dice-orientation";
export function Dice({
  values,
  rolling,
  reduced,
}: {
  values: [number, number];
  rolling: boolean;
  reduced: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    [fallback, setFallback] = useState(false);
  useEffect(() => {
    const div = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      setFallback(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(240, 130);
    div.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(38, 240 / 130, 0.1, 100);
    camera.position.set(0, 6.7, 5);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(-3, 7, 5);
    scene.add(light);
    const mats = DICE_FACES.map((n) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#f4f0df";
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = "#d6cdb7";
      ctx.lineWidth = 6;
      ctx.strokeRect(0, 0, 128, 128);
      ctx.fillStyle = "#193d3a";
      const spots: Record<number, number[][]> = {
        1: [[0, 0]],
        2: [
          [-1, -1],
          [1, 1],
        ],
        3: [
          [-1, -1],
          [0, 0],
          [1, 1],
        ],
        4: [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ],
        5: [
          [-1, -1],
          [1, -1],
          [0, 0],
          [-1, 1],
          [1, 1],
        ],
        6: [
          [-1, -1],
          [1, -1],
          [-1, 0],
          [1, 0],
          [-1, 1],
          [1, 1],
        ],
      };
      for (const [x, y] of spots[n]) {
        ctx.beginPath();
        ctx.arc(64 + x * 31, 64 + y * 31, 10, 0, Math.PI * 2);
        ctx.fill();
      }
      return new THREE.MeshStandardMaterial({
        map: new THREE.CanvasTexture(canvas),
        roughness: 0.45,
      });
    });
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const cubes = values.map((v, i) => {
      const cube = new THREE.Mesh(geometry, mats);
      cube.position.x = i ? 0.85 : -0.85;
      scene.add(cube);
      return cube;
    });
    const targets = values.map(diceOrientation);
    const start = performance.now();
    let raf = 0;
    function frame() {
      const t =
        reduced || !rolling
          ? 1
          : Math.min(1, (performance.now() - start) / 2100);
      cubes.forEach((c, i) => {
        if (t < 0.72) {
          c.rotation.set(t * 20 + i, t * 15, t * 11);
          c.position.y = Math.max(0, Math.sin(t * Math.PI * 3)) * 1.1 * (1 - t);
        } else {
          c.quaternion.slerp(targets[i], Math.min(1, (t - 0.72) / 0.28));
          c.position.y = Math.abs(Math.sin(t * Math.PI * 8)) * (1 - t);
        }
        if (t === 1) {
          c.quaternion.copy(targets[i]);
          c.position.y = 0;
        }
      });
      if (t === 1)
        renderer.domElement.dataset.topFaces = cubes
          .map((c) => topFace(c.quaternion))
          .join(",");
      renderer.render(scene, camera);
      if (t < 1) raf = requestAnimationFrame(frame);
    }
    frame();
    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      geometry.dispose();
      mats.forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
      div.replaceChildren();
    };
  }, [values[0], values[1], rolling, reduced]);
  return (
    <div
      className="dice-wrap"
      role="img"
      aria-label={`주사위 ${values[0]}와 ${values[1]}, 합계 ${values[0] + values[1]}`}
    >
      <div ref={host} />
      <output className="dice-result" aria-live="polite">
        {rolling && !reduced
          ? "주사위를 굴리는 중…"
          : `합계 ${values[0] + values[1]}`}
      </output>
      {fallback && (
        <div className={`dice-fallback ${rolling && !reduced ? "shake" : ""}`}>
          {values.map((v, i) => (
            <span key={i}>{["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"][v]}</span>
          ))}
        </div>
      )}
    </div>
  );
}

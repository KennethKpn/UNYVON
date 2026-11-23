"use client";

import { useEffect, useRef } from "react";

interface CrowdCanvasProps {
  src?: string;
  rows?: number;
  cols?: number;
  className?: string;
}

type SpriteRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Walker = {
  sprite: SpriteRect | null;
  x: number;
  width: number;
  height: number;
  baseline: number;
  speed: number;
  direction: 1 | -1;
  scale: number;
  phase: number;
  opacity: number;
};

const DEFAULT_SPRITE_SHEET =
  "https://cdn.21st.dev/assets/localized/abdb8990a7bef8c2f5af3e45f0a3c969c4b0603fba8be92e81347de4ea4e1ed7.png";

const FALLBACK_COLORS = [
  "#6556E9",
  "#344054",
  "#0C7D49",
  "#7B6DEB",
  "#56627A",
  "#8A6A50",
];

const randomBetween = (min: number, max: number) =>
  min + Math.random() * (max - min);

export function CrowdCanvas({
  src = DEFAULT_SPRITE_SHEET,
  rows = 15,
  cols = 7,
  className = "block h-full w-full",
}: CrowdCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });

    if (!canvas || !context) return;

    const image = new Image();
    image.decoding = "async";

    let stageWidth = 0;
    let stageHeight = 0;
    let pixelRatio = 1;
    let imageReady = false;
    let spriteFailed = false;
    let isInView = false;
    let pageIsVisible = document.visibilityState === "visible";
    let prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let animationFrame = 0;
    let previousTime = 0;
    let walkers: Walker[] = [];
    let disposed = false;

    const clearCanvas = () => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, stageWidth, stageHeight);
    };

    const drawFallbackPerson = (
      walker: Walker,
      time: number,
    ) => {
      const { width, height, phase } = walker;
      const centerX = width * 0.5;
      const headRadius = height * 0.095;
      const headY = height * 0.17;
      const shoulderY = height * 0.36;
      const hipY = height * 0.68;
      const step = Math.sin(time * 5.2 + phase);
      const color = FALLBACK_COLORS[
        Math.abs(Math.floor(phase * 100)) % FALLBACK_COLORS.length
      ];

      context.fillStyle = "#C98E68";
      context.beginPath();
      context.arc(centerX, headY, headRadius, 0, Math.PI * 2);
      context.fill();

      context.strokeStyle = color;
      context.lineWidth = Math.max(3, height * 0.12);
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(centerX, shoulderY);
      context.lineTo(centerX, hipY);
      context.moveTo(centerX, shoulderY + height * 0.04);
      context.lineTo(centerX - width * 0.2, height * 0.58 + step * 2);
      context.moveTo(centerX, shoulderY + height * 0.04);
      context.lineTo(centerX + width * 0.2, height * 0.58 - step * 2);
      context.stroke();

      context.strokeStyle = "#344054";
      context.lineWidth = Math.max(3, height * 0.105);
      context.beginPath();
      context.moveTo(centerX, hipY);
      context.lineTo(centerX - width * 0.13, height * 0.94 + step * 4);
      context.moveTo(centerX, hipY);
      context.lineTo(centerX + width * 0.13, height * 0.94 - step * 4);
      context.stroke();
    };

    const draw = (time: number) => {
      if (!stageWidth || !stageHeight) return;

      clearCanvas();
      const orderedWalkers = [...walkers].sort(
        (first, second) => first.baseline - second.baseline,
      );

      orderedWalkers.forEach((walker) => {
        const bounce = prefersReducedMotion
          ? 0
          : Math.sin(time * 0.0052 + walker.phase) * 1.8;
        const y = walker.baseline - walker.height + bounce;

        context.save();
        context.globalAlpha = walker.opacity;

        if (walker.direction === -1) {
          context.translate(walker.x + walker.width, 0);
          context.scale(-1, 1);
        } else {
          context.translate(walker.x, 0);
        }

        if (walker.sprite && imageReady) {
          const sprite = walker.sprite;
          context.drawImage(
            image,
            sprite.x,
            sprite.y,
            sprite.width,
            sprite.height,
            0,
            y,
            walker.width,
            walker.height,
          );
        } else {
          context.translate(0, y);
          drawFallbackPerson(walker, time);
        }

        context.restore();
      });
    };

    const makeWalkers = () => {
      if (!stageWidth || !stageHeight) return;

      const count =
        stageWidth < 520 ? 5 : stageWidth < 900 ? 7 : 10;
      const cellWidth = imageReady ? image.naturalWidth / rows : 1;
      const cellHeight = imageReady ? image.naturalHeight / cols : 1;
      const available = Array.from(
        { length: rows * cols },
        (_, index) => index,
      );

      walkers = Array.from({ length: count }, (_, index) => {
        const randomPosition = Math.floor(Math.random() * available.length);
        const spriteIndex = available.splice(randomPosition, 1)[0] ?? 0;
        const sprite = imageReady
          ? {
              x: (spriteIndex % rows) * cellWidth,
              y: Math.floor(spriteIndex / rows) * cellHeight,
              width: cellWidth,
              height: cellHeight,
            }
          : null;
        const scale = randomBetween(0.76, 1);
        const height = Math.min(stageHeight * 0.64, 96) * scale;
        const width = imageReady
          ? height * (cellWidth / cellHeight)
          : height * 0.42;
        const direction: 1 | -1 = Math.random() > 0.5 ? 1 : -1;
        const slot = stageWidth / count;
        const x = slot * (index + 0.5) + randomBetween(-slot * 0.22, slot * 0.22);

        return {
          sprite,
          x: x - width / 2,
          width,
          height,
          baseline: stageHeight - 19 - (1 - scale) * 16,
          speed: Math.max(22, stageWidth / randomBetween(19, 27)),
          direction,
          scale,
          phase: randomBetween(0, Math.PI * 2),
          opacity: randomBetween(0.76, 0.96),
        };
      });

      draw(0);
    };

    const resetWalker = (walker: Walker) => {
      walker.direction = Math.random() > 0.5 ? 1 : -1;
      walker.x =
        walker.direction === 1
          ? -walker.width - randomBetween(12, 90)
          : stageWidth + randomBetween(12, 90);
      walker.phase = randomBetween(0, Math.PI * 2);
      walker.speed = Math.max(22, stageWidth / randomBetween(19, 27));
    };

    const stopAnimation = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
      previousTime = 0;
    };

    const animate = (time: number) => {
      if (disposed) return;

      if (!previousTime) previousTime = time;
      const delta = Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;

      walkers.forEach((walker) => {
        walker.x += walker.direction * walker.speed * delta;

        if (
          (walker.direction === 1 && walker.x > stageWidth + walker.width) ||
          (walker.direction === -1 && walker.x < -walker.width)
        ) {
          resetWalker(walker);
        }
      });

      draw(time);
      animationFrame = window.requestAnimationFrame(animate);
    };

    const syncAnimation = () => {
      const shouldAnimate =
        imageReady &&
        isInView &&
        pageIsVisible &&
        !prefersReducedMotion;

      if (shouldAnimate && !animationFrame) {
        previousTime = 0;
        animationFrame = window.requestAnimationFrame(animate);
        return;
      }

      if (!shouldAnimate) {
        stopAnimation();
        if (imageReady || spriteFailed) draw(0);
      }
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;

      stageWidth = bounds.width;
      stageHeight = bounds.height;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(stageWidth * pixelRatio);
      canvas.height = Math.round(stageHeight * pixelRatio);

      makeWalkers();
      syncAnimation();
    };

    const handleVisibilityChange = () => {
      pageIsVisible = document.visibilityState === "visible";
      syncAnimation();
    };

    const motionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const handleMotionChange = (event: MediaQueryListEvent) => {
      prefersReducedMotion = event.matches;

      if (prefersReducedMotion) {
        walkers.forEach((walker, index) => {
          const slot = stageWidth / Math.max(walkers.length, 1);
          walker.x = slot * (index + 0.5) - walker.width / 2;
          walker.direction = 1;
        });
      }

      syncAnimation();
      draw(0);
    };

    const intersectionObserver =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            ([entry]) => {
              isInView = entry.isIntersecting;
              syncAnimation();
            },
            { rootMargin: "120px 0px", threshold: 0 },
          )
        : null;

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(resize)
        : null;

    intersectionObserver?.observe(canvas);
    isInView = intersectionObserver === null;
    resizeObserver?.observe(canvas);

    if (!resizeObserver) {
      window.addEventListener("resize", resize);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    motionQuery.addEventListener("change", handleMotionChange);

    image.onload = () => {
      if (disposed) return;
      imageReady = true;
      makeWalkers();
      syncAnimation();
    };

    image.onerror = () => {
      if (disposed) return;
      spriteFailed = true;
      makeWalkers();
      syncAnimation();
    };

    image.src = src;

    if (canvas.getBoundingClientRect().width) resize();

    return () => {
      disposed = true;
      stopAnimation();
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      motionQuery.removeEventListener("change", handleMotionChange);
      image.onload = null;
      image.onerror = null;
    };
  }, [cols, rows, src]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
    />
  );
}

export default CrowdCanvas;

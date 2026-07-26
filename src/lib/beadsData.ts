/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Preset SVG visualizers for beads to provide high-quality defaults if no picture is uploaded
export const BEADS_PRESETS = [
  {
    id: "preset_seed_red",
    name: "Red Seed Bead (2mm)",
    category: "Seed Beads",
    color: "Crimson Red",
    size: "2mm",
    price: 35.00,
    sku: "BD-SD-RED-2",
    svgColor: "#DC2626",
    svgPath: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z M12 9c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
  },
  {
    id: "preset_seed_pink",
    name: "Baby Pink Seed Bead",
    category: "Seed Beads",
    color: "Baby Pink",
    size: "2mm",
    price: 35.00,
    sku: "BD-SD-PNK-2",
    svgColor: "#F472B6",
    svgPath: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z M12 9c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
  },
  {
    id: "preset_glass_teal",
    name: "Faceted Teal Glass Bead",
    category: "Glass Beads",
    color: "Aqua Teal",
    size: "6mm",
    price: 85.00,
    sku: "BD-GL-AQA-6",
    svgColor: "#0D9488",
    svgPath: "M12 2L2 12l10 10 10-10L12 2zm0 4.14L17.86 12 12 17.86 6.14 12 12 6.14z M12 9.5c-1.38 0-2.5 1.12-2.5 2.5s1.12 2.5 2.5 2.5 2.5-1.12 2.5-2.5-1.12-2.5-2.5-2.5z"
  },
  {
    id: "preset_pastel_star",
    name: "Violet Pastel Star",
    category: "Acrylic Beads",
    color: "Pastel Violet",
    size: "10mm",
    price: 110.00,
    sku: "BD-AC-VIO-10",
    svgColor: "#A78BFA",
    svgPath: "M12 .587l3.668 7.431 8.2 1.192-5.934 5.787 1.4 8.168L12 18.896l-7.334 3.857 1.4-8.168L.132 9.21l8.2-1.192L12 .587z M12 9c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
  },
  {
    id: "preset_clay_flower",
    name: "Sunshine Clay Flower",
    category: "Clay Beads",
    color: "Sunny Yellow",
    size: "8mm",
    price: 120.00,
    sku: "BD-CL-SUN-8",
    svgColor: "#FBBF24",
    svgPath: "M12 2a4 4 0 0 0-4 4 4 4 0 0 0-3.32-.33 4 4 0 0 0-2.6 5.86 4 4 0 0 0 0 4.94 4 4 0 0 0 2.6 5.86c.36.1.73.15 1.1.15a4 4 0 0 0 2.22-.68A4 4 0 0 0 12 22a4 4 0 0 0 4-4c.48.24 1 .37 1.54.37.75 0 1.48-.25 2.08-.71a4 4 0 0 0 1.25-5.11 4 4 0 0 0 0-4.94 4 4 0 0 0-1.25-5.11 4 4 0 0 0-3.62-.33A4 4 0 0 0 12 2zm0 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"
  },
  {
    id: "preset_pearl_cream",
    name: "Lustrous Cream Pearl",
    category: "Pearl & Shell",
    color: "Creamy Ivory",
    size: "8mm",
    price: 150.00,
    sku: "BD-PR-CRM-8",
    svgColor: "#FEF3C7",
    svgPath: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5c0 .28-.22.5-.5.5h-1a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h1c.28 0 .5.22.5.5v1z"
  },
  {
    id: "preset_crystal_gold",
    name: "Golden Champagne Crystal",
    category: "Crystal Beads",
    color: "Champagne Gold",
    size: "8mm",
    price: 180.00,
    sku: "BD-CR-GLD-8",
    svgColor: "#D97706",
    svgPath: "M12 2L4.5 9.5l7.5 12.5 7.5-12.5L12 2zm0 3.5l4.3 4H7.7l4.3-4zm-3 5.5h6l-3 5-3-5z"
  }
];

// SVG Helper that takes preset path and color and builds a base64 Data URL
export function getPresetSvgDataUrl(svgPath: string, color: string): string {
  const svgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}"><rect width="100%" height="100%" fill="#faf8f5" rx="4"/><path d="${svgPath}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgString)}`;
}

// Function to compress public uploads using HTML Canvas to fit well under Firestore limits
export function compressAndConvertImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const squareSize = Math.min(img.width, img.height);
        const targetSize = Math.min(400, squareSize);

        const sx = Math.max(0, (img.width - squareSize) / 2);
        const sy = Math.max(0, (img.height - squareSize) / 2);

        canvas.width = targetSize;
        canvas.height = targetSize;

        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, sx, sy, squareSize, squareSize, 0, 0, targetSize, targetSize);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
          resolve(dataUrl);
        } else {
          resolve(img.src);
        }
      };
      img.onerror = (err) => {
        reject(err);
      };
    };
    reader.onerror = (err) => {
      reject(err);
    };
  });
}

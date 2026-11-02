import React from 'react';
import { cleanIsbn, encodeEan13Bits, formatIsbn13 } from '../utils/isbn';

interface BarcodeSvgProps {
  isbn: string;
  title?: string;
  author?: string;
  compact?: boolean;
}

/**
 * Renders a genuine 95-module EAN-13 barcode in crisp vector SVG format.
 * Compatible with physical handheld laser/CCD barcode scanners and camera scanners.
 */
export const BarcodeSvg: React.FC<BarcodeSvgProps> = ({
  isbn,
  title,
  author,
  compact = false,
}) => {
  const cleaned = cleanIsbn(isbn);
  let bits = '';
  try {
    bits = encodeEan13Bits(cleaned.length === 13 ? cleaned : cleaned.padStart(13, '0').slice(0, 13));
  } catch {
    bits = encodeEan13Bits('9790000000002');
  }

  const quietZoneModules = 9;
  const totalModules = bits.length + quietZoneModules * 2; // 95 + 18 = 113
  const barHeight = compact ? 38 : 54;
  const guardBarHeight = compact ? 44 : 62;
  const svgHeight = compact ? 58 : 78;

  const isGuardBit = (index: number) => {
    return (
      index < 3 ||
      (index >= 45 && index < 50) ||
      index >= 92
    );
  };

  return (
    <div className="inline-flex flex-col items-center bg-white text-slate-950 select-all max-w-full">
      {!compact && (title || author) && (
        <div className="w-full text-center mb-1.5 px-2">
          {title && (
            <div className="text-xs font-semibold text-slate-900 truncate max-w-[220px] mx-auto">
              {title}
            </div>
          )}
          {author && (
            <div className="text-[11px] text-slate-600 truncate max-w-[220px] mx-auto">
              {author}
            </div>
          )}
        </div>
      )}
      <svg
        viewBox={`0 0 ${totalModules} ${svgHeight}`}
        className={compact ? 'w-36 max-w-full h-12' : 'w-56 max-w-full h-20'}
        role="img"
        aria-label={`ISBN Barcode ${formatIsbn13(cleaned)}`}
      >
        <rect x="0" y="0" width={totalModules} height={svgHeight} fill="#ffffff" />
        {bits.split('').map((bit, idx) => {
          if (bit !== '1') return null;
          const x = quietZoneModules + idx;
          const height = isGuardBit(idx) ? guardBarHeight : barHeight;
          return (
            <rect
              key={idx}
              x={x}
              y={2}
              width={1}
              height={height}
              fill="#0f172a"
            />
          );
        })}
        <text
          x={totalModules / 2}
          y={svgHeight - 3}
          textAnchor="middle"
          fill="#0f172a"
          fontSize={compact ? '7.5' : '8.2'}
          fontFamily="JetBrains Mono, monospace"
          fontWeight="600"
          letterSpacing="0.4"
        >
          {formatIsbn13(cleaned)}
        </text>
      </svg>
    </div>
  );
};

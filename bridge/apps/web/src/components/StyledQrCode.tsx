import QRCodeStyling, { type Options } from "qr-code-styling";
import React, { useEffect, useRef, useState } from "react";

interface StyledQrCodeProps {
  data: string;
  size?: number;
  className?: string;
}

export const StyledQrCode: React.FC<StyledQrCodeProps> = ({
  data,
  size = 200,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const qrCodeRef = useRef<QRCodeStyling | null>(null);

  const [isDark, setIsDark] = useState<boolean>(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const checkTheme = () => {
      setIsDark(document.documentElement.classList.contains("dark"));
    };
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current || !data) return;

    // Strict foreground color matching current theme
    const fgColor = isDark ? "#ECEDEE" : "#11181C";

    const options: Options = {
      width: size,
      height: size,
      type: "svg",
      data,
      margin: 4,
      qrOptions: {
        typeNumber: 0,
        mode: "Byte",
        errorCorrectionLevel: "M",
      },
      dotsOptions: {
        type: "dots",
        color: fgColor,
      },
      cornersSquareOptions: {
        type: "square",
        color: fgColor,
      },
      cornersDotOptions: {
        type: "square",
        color: fgColor,
      },
      backgroundOptions: {
        color: "transparent",
      },
    };

    if (!qrCodeRef.current) {
      qrCodeRef.current = new QRCodeStyling(options);
      containerRef.current.innerHTML = "";
      qrCodeRef.current.append(containerRef.current);
    } else {
      qrCodeRef.current.update(options);
    }
  }, [data, size, isDark]);

  return (
    <div
      ref={containerRef}
      className={`flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    />
  );
};

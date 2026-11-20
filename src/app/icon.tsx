import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0b1220 0%, #162032 100%)",
          borderRadius: 6,
          border: "1px solid #2d4a7a",
        }}
      >
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "#5eb8ff",
            fontFamily: "ui-monospace, monospace",
          }}
        >
          O
        </div>
      </div>
    ),
    { ...size }
  );
}
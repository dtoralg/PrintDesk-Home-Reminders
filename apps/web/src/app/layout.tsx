import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./styles.css";

const poppins = localFont({
  src: [
    {
      path: "../../../../packages/ticket-renderer/assets/fonts/Poppins-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../../../packages/ticket-renderer/assets/fonts/Poppins-SemiBold.ttf",
      weight: "600",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: "PrintDesk",
  description: "Ideas y tareas que salen del ruido digital.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#11110f", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={poppins.variable} lang="es">
      <body>{children}</body>
    </html>
  );
}

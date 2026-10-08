import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Benchroom — LLM performance lab",
  description: "Benchmark TTFT, latency, and throughput across OpenAI-compatible endpoints.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

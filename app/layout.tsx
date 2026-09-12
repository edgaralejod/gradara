import type { Metadata } from 'next';
import './globals.css';
import './engineering.css';
export const metadata: Metadata = {
  title: 'Gradara — Modeling workspace',
  description:
    'A local multidomain simulation workbench with agent-assisted components.',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

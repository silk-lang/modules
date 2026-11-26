/// <reference types="vite/client" />
declare module "*.txt?raw" { const text: string; export default text; }
declare namespace JSX { interface IntrinsicElements { box: any } }
declare module "xb-page.json" { const page: unknown; export default page; }

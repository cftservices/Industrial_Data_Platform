/**
 * Management-familie. Mag chrome hebben: accentkleur, radius, schaduw, ruimere
 * dichtheid. De statustaal is identiek aan die van de ops-familie; alleen de
 * omlijsting verschilt.
 */
export default function MgmtLayout({ children }: { children: React.ReactNode }) {
  return <div data-ui="mgmt">{children}</div>;
}

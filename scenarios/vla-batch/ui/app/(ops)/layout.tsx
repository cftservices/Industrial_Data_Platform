/**
 * Operator-familie. Geen accentkleur (hij bestaat, maar is grijs), geen radius,
 * geen schaduw, hogere dichtheid. Zo kan een operatorscherm geen decoratieve
 * kleur gebruiken, ook niet per ongeluk, zonder dat componenten hoeven te weten
 * in welke familie ze staan.
 */
export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return <div data-ui="ops">{children}</div>;
}

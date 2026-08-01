import { Suspense } from "react";
import { EquipmentHealth } from "@/components/screens/EquipmentHealth";

export const metadata = { title: "Equipment, DairyWorks Vla" };

export default function EquipmentPage() {
  return (
    <Suspense>
      <EquipmentHealth />
    </Suspense>
  );
}

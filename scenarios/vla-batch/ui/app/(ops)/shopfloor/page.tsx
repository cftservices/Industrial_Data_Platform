import { Suspense } from "react";
import { Shopfloor } from "@/components/screens/Shopfloor";

export const metadata = { title: "Werkvloer, DairyWorks Vla" };

export default function ShopfloorPage() {
  return (
    <Suspense>
      <Shopfloor />
    </Suspense>
  );
}

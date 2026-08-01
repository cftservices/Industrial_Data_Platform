import { Suspense } from "react";
import { Orders } from "@/components/screens/Orders";

export const metadata = { title: "Orders, DairyWorks Vla" };

export default function OrdersPage() {
  return (
    <Suspense>
      <Orders />
    </Suspense>
  );
}

import { redirect } from "next/navigation";

// The Calendar tab is the default view.
export default function Home() {
  redirect("/calendar");
}

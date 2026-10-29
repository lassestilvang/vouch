import type { Metadata } from "next";
import Deck from "@/components/Deck";

export const metadata: Metadata = {
  title: "Vouch: pitch deck",
  description: "Why Vouch exists, how it uses Nemotron on Nebius Token Factory, and what we measured.",
};

export default function PitchPage() {
  return <Deck />;
}

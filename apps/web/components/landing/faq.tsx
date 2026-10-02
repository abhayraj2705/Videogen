"use client";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export const FAQ_ITEMS = [
  {
    q: "What do I need to get started?",
    a: "Just a public URL. We read your site, write a script grounded in what's actually on it, voice it, and render a motion video in your brand colors. No card needed for the free plan.",
  },
  {
    q: "Will it make things up about my product?",
    a: "No. Every claim and number on screen must trace back to a fact we found on your site. You can review and edit the script before rendering, and anything you add yourself is flagged as unverified.",
  },
  {
    q: "Which formats do I get?",
    a: "16:9 for YouTube and landing pages, 9:16 for Reels/Shorts/Stories, and 1:1 for feed posts. Pick one, or all three for one extra credit each.",
  },
  {
    q: "What if my site blocks bots?",
    a: "Some sites block automated browsers. When that happens we ask you for a few screenshots and a short description instead, and carry on from there.",
  },
  {
    q: "Can I use it on a site I don't own?",
    a: "Only if you have permission to promote it. Misuse is against our Acceptable Use Policy, free videos carry a watermark, and we honour takedown requests.",
  },
  {
    q: "Which languages are supported?",
    a: "English and Hindi voiceovers today, with captions on every video.",
  },
];

export function Faq() {
  return (
    <Accordion type="single" collapsible className="w-full">
      {FAQ_ITEMS.map((item, i) => (
        <AccordionItem key={item.q} value={`faq-${i}`}>
          <AccordionTrigger className="text-left text-base">{item.q}</AccordionTrigger>
          <AccordionContent className="text-muted-foreground">{item.a}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

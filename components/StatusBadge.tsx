"use client";
// Maps an assignment status to a colored badge.
import Badge, { BadgeTone } from "./common/Badge";
import { STATUS_LABELS, type AssignmentStatus } from "@/lib/constants";

const STATUS_TONES: Record<AssignmentStatus, BadgeTone> = {
  PENDING: "amber",
  CONFIRMED: "green",
  SWAP_REQUESTED: "red",
};

export default function StatusBadge({ status }: { status: AssignmentStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}

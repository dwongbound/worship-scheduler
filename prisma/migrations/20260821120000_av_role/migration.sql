-- A/V role: a new Instrument enum value for the sound + slides slot. Unlike
-- CHOIR this IS a band role — it carries a slot count in the team shape
-- (SLOT_CAPACITIES.AV = 1, so every set gets one A/V slot by default) and sits
-- last in ROLE_ORDER, since it's tech rather than music. Existing sets need no
-- data change: a stored slotCapacities override is merged over the defaults
-- (lib/constants.ts resolveCapacities), so a map written before A/V existed
-- picks up the default of 1.

-- AlterEnum
ALTER TYPE "Instrument" ADD VALUE 'AV';

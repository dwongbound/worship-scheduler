-- Choir role: a new Instrument enum value. Unlike the band roles it carries no
-- fixed slot count in the team shape — it's an unbounded, admin-managed list on
-- a set (see lib/constants.ts: CHOIR is deliberately kept out of SLOT_CAPACITIES
-- and ROLE_ORDER).

-- AlterEnum
ALTER TYPE "Instrument" ADD VALUE 'CHOIR';

-- Migration 0017 : cleanup du bug d'écrasement staff.email
--
-- Contexte : createCashierAccess écrivait l'email interne (`cashier-{id}@internal.systemaone`)
-- dans staff.email, écrasant l'éventuel email de contact du membre.
-- Cette migration remet à NULL les staff.email qui contiennent un email interne.
-- Désormais, l'email interne est dérivé du staffId à la volée et jamais stocké.

UPDATE public.staff
SET email = NULL
WHERE email LIKE 'cashier-%@internal.systemaone';

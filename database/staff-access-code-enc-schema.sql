-- Migration 0011 — Version chiffrée réversible des codes d'accès staff.
-- Additive et idempotente. Le hash SHA-256 (access_code_hash) reste l'unique
-- référence de vérification au login ; access_code_enc stocke le MÊME code
-- chiffré (AES-256-GCM, clé dérivée de STAFF_AUTH_SECRET via HKDF) afin de
-- pouvoir le RÉVÉLER (copier) sur demande d'un rôle autorisé, sans jamais
-- écrire le code en clair au repos ni le régénérer.
-- Runtime note: lib/staff-auth.js ajoute aussi ces colonnes au bootstrap.

alter table staff_roles add column if not exists access_code_enc text;
alter table staff_members add column if not exists access_code_enc text;

---
name: "Pinlane Platform"
description: "Multi-tenant operations OS for bowling and leisure centres."
colors:
  page: "#050609"
  surface: "#0a0d12"
  raised: "#10151d"
  line: "#202735"
  text: "#f4f7fb"
  muted: "#9aa7b8"
  faint: "#6f7a8c"
  accent: "#b8ad9b"
  accent-soft: "#1b1712"
  success: "#37c984"
  warning: "#d99a2b"
  danger: "#e36d67"
  info: "#5d8dff"
typography:
  body:
    fontFamily: "Inter, Aptos, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.45
  title:
    fontFamily: "Inter, Aptos, Segoe UI, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 760
    lineHeight: 1.08
  label:
    fontFamily: "Inter, Aptos, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 720
    lineHeight: 1.2
    letterSpacing: "0.08em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.text}"
    textColor: "{colors.page}"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "18px"
---

# Design System: Pinlane Platform

## 1. Overview

**Creative North Star: "The Operating Console"**

Pinlane should look like a serious SaaS used by operators, venue directors and a platform owner. The UI is dark, precise, low-noise and data-led. Fun Galaxy branding appears as tenant context only.

Key characteristics:

- Mostly black and neutral surfaces.
- One restrained platinum or muted violet accent for navigation and primary actions.
- Status colors are functional only.
- Tight, readable layouts with consistent alignment.
- Fewer visual tricks, more hierarchy and usable controls.

## 2. Colors

Primary surfaces use black and near-black. Cards rely on border and tonal contrast, not large shadows or glow. The accent is muted platinum/champagne, reserved for primary navigation, active states and important actions.

Status colors:

- Green: paid, successful, active.
- Amber: arrived, warning, attention.
- Blue: confirmed, direct operational reservations.
- Red: danger, failed, blocked.

## 3. Typography

Use Inter / Aptos / Segoe UI / system-ui. Prefer clear weight contrast over oversized text. Use tabular numbers for dates, times, money and capacity.

## 4. Components

Buttons are compact, direct and predictable. Forms show visible labels and strong focus rings. Tables and planning views should scan quickly. Empty states explain what is missing and what the user can do next.

## 5. Product Rule

Never make a visible feature look connected if it is not connected. A button must perform a real action, navigate to a real page, open a real menu or be removed.

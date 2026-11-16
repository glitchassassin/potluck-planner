# Potluck Planner design system

Potluck Planner uses a shared palette, type scale, and set of component styles. Event themes use different background photos with the same typography and controls.

[`app/ui/design-system.ts`](../app/ui/design-system.ts) defines the light and dark palettes, typography, spacing, and component styles.

Use the display face for headings and the body face for copy, metadata, and controls. Use sentence case for interface copy and reserve uppercase for eyebrows.

## Layout and components

- **Layout.** Center the wordmark in the app bar. Use a compact single column for short forms and dialogs.
- **Section cards.** Use square-cornered cards to group major content sections. Lists and feedback sit directly on the section surface.
- **Photo headers.** Center the eyebrow, title, and supporting metadata over the photo.
- **Buttons.** Use a filled button with clipped corners for primary actions. Make it full width in compact forms. Use underlined text for secondary actions.
- **Fields.** Use a transparent field with an underline. Place a visible label above the field and helper or error text below it. When validation fails, use the error color for the underline and explain how to correct the error in text.
- **List rows.** Separate rows with fine horizontal dividers. Place the primary label first and supporting details second. Keep row actions beside the item they affect.
- **Confirmations and feedback.** Give confirmation dialogs an accent rule along the leading edge. Put the consequences above the confirmation action. For destructive actions, name the action and provide a clear cancel action. Use a short message with a check icon for successful completion.

## Event backgrounds

The backgrounds are 1160 × 464 WebP photos in [`public/event-backgrounds`](../public/event-backgrounds). The server exposes them under `/event-backgrounds/`.

| Theme               | Image                                                                        | Tablecloth                                           | Subject                                           |
| ------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Default             | [default.webp](../public/event-backgrounds/default.webp)                     | Pine-green linen                                     | A shared table with bread, salad, and a casserole |
| Birthday            | [birthday.webp](../public/event-backgrounds/birthday.webp)                   | Dark plum cotton with confetti stitches at the edges | Homemade birthday cake, candles, and strawberries |
| Thanksgiving / Fall | [thanksgiving-fall.webp](../public/event-backgrounds/thanksgiving-fall.webp) | Burnt-rust linen                                     | Pumpkin pie, squash, and roasted vegetables       |
| Christmas / Winter  | [christmas-winter.webp](../public/event-backgrounds/christmas-winter.webp)   | Cranberry linen                                      | Star cookies, cranberries, and evergreen          |
| Picnic / Summer     | [picnic-summer.webp](../public/event-backgrounds/picnic-summer.webp)         | Denim-blue gingham                                   | Watermelon, berries, sandwiches, and lemonade     |

Use the default background when no event theme is selected. Center the photo and scale it to cover the header. Keep the main subjects near the edges and the center dark and clear for cream and amber text. If text reaches a brighter area in a responsive crop, add a translucent dark overlay. Render overlay copy as live text and treat the photo as decorative.

/**
 * FitCoach anatomy atlas — first-party vector anatomy.
 *
 * The atlas maps the muscle/structure taxonomy (packages/db seed slugs) to
 * owned SVG regions on three figure views: front, back, side. Nothing here is
 * third-party artwork: every path is hand-authored FitCoach content, so the
 * anatomy can never carry a provenance or licensing question.
 *
 * Asset strategy: this is the owned v1 anatomy layer. The renderer consumes
 * region keys, so upgraded artwork (richer paths, commissioned illustration)
 * can replace the path data without touching any screen — the contract is
 * `AnatomyRegion.key` ↔ taxonomy slug. Deep muscles that do not have distinct
 * surface geometry (vastus_intermedius, obliques_internal,
 * transversus_abdominis, gluteus_minimus, semimembranosus) resolve to their
 * surface region; that is documented anatomical honesty, not a blob.
 */

export type AnatomyView = "front" | "back" | "side";

export interface AnatomyRegion {
  /** Stable region key, e.g. "front:pectoralis_major.clavicular_head". */
  key: string;
  view: AnatomyView;
  /** Accessible muscle name for this region. */
  label: string;
  /** SVG path data (viewBox 0 0 200 460). */
  d: string;
}

export const ANATOMY_VIEWBOX = "0 0 200 460";

// ---------------------------------------------------------------------------
// Front view
// ---------------------------------------------------------------------------

const FRONT: readonly AnatomyRegion[] = [
  {
    key: "front:trapezius.upper_region",
    view: "front",
    label: "Upper trapezius",
    d: "M78 66 C84 74 90 80 100 80 C110 80 116 74 122 66 L128 84 C118 92 110 95 100 95 C90 95 82 92 72 84 Z",
  },
  {
    key: "front:deltoid_front.left",
    view: "front",
    label: "Front deltoid",
    d: "M44 96 C52 90 64 88 72 92 C76 100 76 112 72 122 C62 128 50 126 44 118 C42 110 42 102 44 96 Z",
  },
  {
    key: "front:deltoid_front.right",
    view: "front",
    label: "Front deltoid",
    d: "M156 96 C148 90 136 88 128 92 C124 100 124 112 128 122 C138 128 150 126 156 118 C158 110 158 102 156 96 Z",
  },
  {
    key: "front:deltoid_side.left",
    view: "front",
    label: "Side deltoid",
    d: "M38 100 C42 94 46 92 50 92 C52 102 52 114 48 124 C44 128 40 128 38 124 C36 116 36 107 38 100 Z",
  },
  {
    key: "front:deltoid_side.right",
    view: "front",
    label: "Side deltoid",
    d: "M162 100 C158 94 154 92 150 92 C148 102 148 114 152 124 C156 128 160 128 162 124 C164 116 164 107 162 100 Z",
  },
  {
    key: "front:pectoralis_major.clavicular_head.left",
    view: "front",
    label: "Upper chest (clavicular)",
    d: "M76 96 C84 92 92 92 99 96 L99 112 C90 110 82 108 74 110 C73 104 74 99 76 96 Z",
  },
  {
    key: "front:pectoralis_major.clavicular_head.right",
    view: "front",
    label: "Upper chest (clavicular)",
    d: "M124 96 C116 92 108 92 101 96 L101 112 C110 110 118 108 126 110 C127 104 126 99 124 96 Z",
  },
  {
    key: "front:pectoralis_major.sternal_head.left",
    view: "front",
    label: "Mid chest (sternal)",
    d: "M74 112 C82 110 91 112 99 114 L99 146 C90 148 80 146 72 140 C70 130 71 120 74 112 Z",
  },
  {
    key: "front:pectoralis_major.sternal_head.right",
    view: "front",
    label: "Mid chest (sternal)",
    d: "M126 112 C118 110 109 112 101 114 L101 146 C110 148 120 146 128 140 C130 130 129 120 126 112 Z",
  },
  {
    key: "front:biceps_brachii.long_head.left",
    view: "front",
    label: "Biceps — long head",
    d: "M48 132 C54 128 60 128 63 132 C65 146 64 166 61 182 C56 186 50 186 47 182 C45 165 45 147 48 132 Z",
  },
  {
    key: "front:biceps_brachii.long_head.right",
    view: "front",
    label: "Biceps — long head",
    d: "M152 132 C146 128 140 128 137 132 C135 146 136 166 139 182 C144 186 150 186 153 182 C155 165 155 147 152 132 Z",
  },
  {
    key: "front:biceps_brachii.short_head.left",
    view: "front",
    label: "Biceps — short head",
    d: "M63 134 C67 132 70 133 71 137 C72 150 71 168 68 181 C66 184 63 184 62 181 C63 166 63 149 63 134 Z",
  },
  {
    key: "front:biceps_brachii.short_head.right",
    view: "front",
    label: "Biceps — short head",
    d: "M137 134 C133 132 130 133 129 137 C128 150 129 168 132 181 C134 184 137 184 138 181 C137 166 137 149 137 134 Z",
  },
  {
    key: "front:brachialis.left",
    view: "front",
    label: "Brachialis",
    d: "M46 184 C49 183 51 184 52 186 L51 200 C48 201 46 200 45 198 Z",
  },
  {
    key: "front:brachialis.right",
    view: "front",
    label: "Brachialis",
    d: "M154 184 C151 183 149 184 148 186 L149 200 C152 201 154 200 155 198 Z",
  },
  {
    key: "front:brachioradialis.left",
    view: "front",
    label: "Brachioradialis",
    d: "M52 202 C56 200 60 201 61 204 C62 214 61 226 58 236 C55 238 52 237 51 234 C50 223 50 211 52 202 Z",
  },
  {
    key: "front:brachioradialis.right",
    view: "front",
    label: "Brachioradialis",
    d: "M148 202 C144 200 140 201 139 204 C138 214 139 226 142 236 C145 238 148 237 149 234 C150 223 150 211 148 202 Z",
  },
  {
    key: "front:forearm_flexors.left",
    view: "front",
    label: "Forearm flexors",
    d: "M48 238 C53 236 58 236 60 239 C61 250 60 262 57 272 C53 274 49 273 47 270 C46 259 46 247 48 238 Z",
  },
  {
    key: "front:forearm_flexors.right",
    view: "front",
    label: "Forearm flexors",
    d: "M152 238 C147 236 142 236 140 239 C139 250 140 262 143 272 C147 274 151 273 153 270 C154 259 154 247 152 238 Z",
  },
  {
    key: "front:rectus_abdominis",
    view: "front",
    label: "Rectus abdominis",
    d: "M88 152 C94 150 106 150 112 152 C114 168 114 186 112 202 C110 220 106 238 100 246 C94 238 90 220 88 202 C86 186 86 168 88 152 Z M100 160 L100 246 M90 178 L110 178 M90 196 L110 196 M92 214 L108 214",
  },
  {
    key: "front:obliques.left",
    view: "front",
    label: "Obliques",
    d: "M70 150 C76 152 80 156 84 162 C82 182 80 204 76 224 C72 222 68 216 66 208 C64 188 66 166 70 150 Z",
  },
  {
    key: "front:obliques.right",
    view: "front",
    label: "Obliques",
    d: "M130 150 C124 152 120 156 116 162 C118 182 120 204 124 224 C128 222 132 216 134 208 C136 188 134 166 130 150 Z",
  },
  {
    key: "front:quadriceps.rectus_femoris.left",
    view: "front",
    label: "Rectus femoris",
    d: "M80 256 C86 254 94 254 96 258 C97 284 96 316 92 344 C87 348 81 348 78 344 C75 316 76 284 80 256 Z",
  },
  {
    key: "front:quadriceps.rectus_femoris.right",
    view: "front",
    label: "Rectus femoris",
    d: "M120 256 C114 254 106 254 104 258 C103 284 104 316 108 344 C113 348 119 348 122 344 C125 316 124 284 120 256 Z",
  },
  {
    key: "front:quadriceps.vastus_lateralis.left",
    view: "front",
    label: "Vastus lateralis",
    d: "M64 260 C69 256 76 256 79 260 C78 288 77 320 74 348 C69 352 63 350 61 344 C59 316 60 286 64 260 Z",
  },
  {
    key: "front:quadriceps.vastus_lateralis.right",
    view: "front",
    label: "Vastus lateralis",
    d: "M136 260 C131 256 124 256 121 260 C122 288 123 320 126 348 C131 352 137 350 139 344 C141 316 140 286 136 260 Z",
  },
  {
    key: "front:quadriceps.vastus_medialis.left",
    view: "front",
    label: "Vastus medialis",
    d: "M93 320 C97 318 100 320 101 324 C102 336 101 350 98 360 C94 362 91 360 90 356 C89 344 90 330 93 320 Z",
  },
  {
    key: "front:quadriceps.vastus_medialis.right",
    view: "front",
    label: "Vastus medialis",
    d: "M107 320 C103 318 100 320 99 324 C98 336 99 350 102 360 C106 362 109 360 110 356 C111 344 110 330 107 320 Z",
  },
  {
    key: "front:adductor_group.left",
    view: "front",
    label: "Adductors",
    d: "M97 258 C99 262 100 268 99 276 L94 316 C92 318 90 318 89 316 C91 296 94 274 97 258 Z",
  },
  {
    key: "front:adductor_group.right",
    view: "front",
    label: "Adductors",
    d: "M103 258 C101 262 100 268 101 276 L106 316 C108 318 110 318 111 316 C109 296 106 274 103 258 Z",
  },
];

// ---------------------------------------------------------------------------
// Back view
// ---------------------------------------------------------------------------

const BACK: readonly AnatomyRegion[] = [
  {
    key: "back:trapezius.upper_region",
    view: "back",
    label: "Upper traps",
    d: "M78 66 C84 74 90 78 100 78 C110 78 116 74 122 66 L126 88 C116 96 108 99 100 99 C92 99 84 96 74 88 Z",
  },
  {
    key: "back:trapezius.middle_region",
    view: "back",
    label: "Mid traps",
    d: "M76 92 C86 100 92 102 100 102 C108 102 114 100 124 92 L120 132 C112 138 106 140 100 140 C94 140 88 138 80 132 Z",
  },
  {
    key: "back:trapezius.lower_region",
    view: "back",
    label: "Lower traps",
    d: "M84 140 C90 144 96 146 100 146 C104 146 110 144 116 140 L110 190 C106 194 103 196 100 196 C97 196 94 194 90 190 Z",
  },
  {
    key: "back:deltoid_rear.left",
    view: "back",
    label: "Rear deltoid",
    d: "M44 96 C52 90 64 88 72 92 C76 100 76 112 72 122 C62 128 50 126 44 118 C42 110 42 102 44 96 Z",
  },
  {
    key: "back:deltoid_rear.right",
    view: "back",
    label: "Rear deltoid",
    d: "M156 96 C148 90 136 88 128 92 C124 100 124 112 128 122 C138 128 150 126 156 118 C158 110 158 102 156 96 Z",
  },
  {
    key: "back:deltoid_side.left",
    view: "back",
    label: "Side deltoid",
    d: "M38 100 C42 94 46 92 50 92 C52 102 52 114 48 124 C44 128 40 128 38 124 C36 116 36 107 38 100 Z",
  },
  {
    key: "back:deltoid_side.right",
    view: "back",
    label: "Side deltoid",
    d: "M162 100 C158 94 154 92 150 92 C148 102 148 114 152 124 C156 128 160 128 162 124 C164 116 164 107 162 100 Z",
  },
  {
    key: "back:rhomboid_major",
    view: "back",
    label: "Rhomboids",
    d: "M94 104 C97 103 103 103 106 104 L104 128 C102 129 98 129 96 128 Z",
  },
  {
    key: "back:teres_major.left",
    view: "back",
    label: "Teres major",
    d: "M66 118 C70 116 74 117 76 121 L72 134 C68 135 65 133 64 130 Z",
  },
  {
    key: "back:teres_major.right",
    view: "back",
    label: "Teres major",
    d: "M134 118 C130 116 126 117 124 121 L128 134 C132 135 135 133 136 130 Z",
  },
  {
    key: "back:latissimus_dorsi.left",
    view: "back",
    label: "Latissimus dorsi",
    d: "M64 136 C72 140 80 146 86 154 C88 178 86 204 80 228 C72 224 66 214 62 200 C58 178 60 154 64 136 Z",
  },
  {
    key: "back:latissimus_dorsi.right",
    view: "back",
    label: "Latissimus dorsi",
    d: "M136 136 C128 140 120 146 114 154 C112 178 114 204 120 228 C128 224 134 214 138 200 C142 178 140 154 136 136 Z",
  },
  {
    key: "back:erector_spinae.left",
    view: "back",
    label: "Spinal erectors",
    d: "M92 150 C94 149 96 149 97 150 C97 180 96 212 94 240 C92 242 90 242 89 240 C88 210 89 178 92 150 Z",
  },
  {
    key: "back:erector_spinae.right",
    view: "back",
    label: "Spinal erectors",
    d: "M108 150 C106 149 104 149 103 150 C103 180 104 212 106 240 C108 242 110 242 111 240 C112 210 111 178 108 150 Z",
  },
  {
    key: "back:triceps_brachii.long_head.left",
    view: "back",
    label: "Triceps — long head",
    d: "M52 132 C56 129 61 129 63 133 C64 148 63 168 60 184 C56 187 52 187 50 184 C48 167 49 148 52 132 Z",
  },
  {
    key: "back:triceps_brachii.long_head.right",
    view: "back",
    label: "Triceps — long head",
    d: "M148 132 C144 129 139 129 137 133 C136 148 137 168 140 184 C144 187 148 187 150 184 C152 167 151 148 148 132 Z",
  },
  {
    key: "back:triceps_brachii.lateral_head.left",
    view: "back",
    label: "Triceps — lateral head",
    d: "M42 134 C45 131 49 131 51 134 C52 148 51 166 48 180 C45 183 42 182 41 179 C40 164 40 148 42 134 Z",
  },
  {
    key: "back:triceps_brachii.lateral_head.right",
    view: "back",
    label: "Triceps — lateral head",
    d: "M158 134 C155 131 151 131 149 134 C148 148 149 166 152 180 C155 183 158 182 159 179 C160 164 160 148 158 134 Z",
  },
  {
    key: "back:triceps_brachii.medial_head.left",
    view: "back",
    label: "Triceps — medial head",
    d: "M50 186 C53 185 56 185 58 187 L57 200 C54 202 51 201 50 199 Z",
  },
  {
    key: "back:triceps_brachii.medial_head.right",
    view: "back",
    label: "Triceps — medial head",
    d: "M150 186 C147 185 144 185 142 187 L143 200 C146 202 149 201 150 199 Z",
  },
  {
    key: "back:forearm_extensors.left",
    view: "back",
    label: "Forearm extensors",
    d: "M48 204 C53 202 58 202 60 205 C61 216 60 228 57 238 C53 240 49 239 47 236 C46 225 46 213 48 204 Z",
  },
  {
    key: "back:forearm_extensors.right",
    view: "back",
    label: "Forearm extensors",
    d: "M152 204 C147 202 142 202 140 205 C139 216 140 228 143 238 C147 240 151 239 153 236 C154 225 154 213 152 204 Z",
  },
  {
    key: "back:gluteus_medius.left",
    view: "back",
    label: "Gluteus medius",
    d: "M70 244 C76 241 84 242 88 246 L85 262 C79 265 72 263 68 258 Z",
  },
  {
    key: "back:gluteus_medius.right",
    view: "back",
    label: "Gluteus medius",
    d: "M130 244 C124 241 116 242 112 246 L115 262 C121 265 128 263 132 258 Z",
  },
  {
    key: "back:gluteus_maximus.left",
    view: "back",
    label: "Glutes",
    d: "M68 262 C76 258 88 258 94 264 C97 278 96 296 90 310 C80 316 69 314 63 306 C60 290 62 272 68 262 Z",
  },
  {
    key: "back:gluteus_maximus.right",
    view: "back",
    label: "Glutes",
    d: "M132 262 C124 258 112 258 106 264 C103 278 104 296 110 310 C120 316 131 314 137 306 C140 290 138 272 132 262 Z",
  },
  {
    key: "back:adductor_group.left",
    view: "back",
    label: "Adductors",
    d: "M95 312 C97 310 99 310 99 312 L96 344 C94 346 92 346 91 344 C92 332 93 320 95 312 Z",
  },
  {
    key: "back:adductor_group.right",
    view: "back",
    label: "Adductors",
    d: "M105 312 C103 310 101 310 101 312 L104 344 C106 346 108 346 109 344 C108 332 107 320 105 312 Z",
  },
  {
    key: "back:hamstrings.biceps_femoris.left",
    view: "back",
    label: "Hamstrings — biceps femoris",
    d: "M64 316 C69 313 75 313 77 317 C78 338 77 362 73 384 C69 387 64 386 62 381 C60 359 61 335 64 316 Z",
  },
  {
    key: "back:hamstrings.biceps_femoris.right",
    view: "back",
    label: "Hamstrings — biceps femoris",
    d: "M136 316 C131 313 125 313 123 317 C122 338 123 362 127 384 C131 387 136 386 138 381 C140 359 139 335 136 316 Z",
  },
  {
    key: "back:hamstrings.semitendinosus.left",
    view: "back",
    label: "Hamstrings — semitendinosus",
    d: "M80 318 C84 316 88 316 89 319 C90 338 89 360 86 380 C83 382 80 381 79 378 C78 358 78 336 80 318 Z",
  },
  {
    key: "back:hamstrings.semitendinosus.right",
    view: "back",
    label: "Hamstrings — semitendinosus",
    d: "M120 318 C116 316 112 316 111 319 C110 338 111 360 114 380 C117 382 120 381 121 378 C122 358 122 336 120 318 Z",
  },
  {
    key: "back:gastrocnemius.medial_head.left",
    view: "back",
    label: "Gastrocnemius — medial head",
    d: "M82 392 C86 390 90 390 91 393 C92 406 91 420 88 430 C84 432 81 431 80 427 C79 415 80 401 82 392 Z",
  },
  {
    key: "back:gastrocnemius.medial_head.right",
    view: "back",
    label: "Gastrocnemius — medial head",
    d: "M118 392 C114 390 110 390 109 393 C108 406 109 420 112 430 C116 432 119 431 120 427 C121 415 120 401 118 392 Z",
  },
  {
    key: "back:gastrocnemius.lateral_head.left",
    view: "back",
    label: "Gastrocnemius — lateral head",
    d: "M68 392 C72 390 76 390 77 393 C78 404 77 416 74 426 C71 428 68 427 67 423 C66 412 66 400 68 392 Z",
  },
  {
    key: "back:gastrocnemius.lateral_head.right",
    view: "back",
    label: "Gastrocnemius — lateral head",
    d: "M132 392 C128 390 124 390 123 393 C122 404 123 416 126 426 C129 428 132 427 133 423 C134 412 134 400 132 392 Z",
  },
  {
    key: "back:soleus.left",
    view: "back",
    label: "Soleus",
    d: "M70 430 C74 428 84 428 88 431 C89 441 88 449 86 455 C81 456 74 456 70 454 C68 446 68 437 70 430 Z",
  },
  {
    key: "back:soleus.right",
    view: "back",
    label: "Soleus",
    d: "M130 430 C126 428 116 428 112 431 C111 441 112 449 114 455 C119 456 126 456 130 454 C132 446 132 437 130 430 Z",
  },
];

// ---------------------------------------------------------------------------
// Side view (facing left)
// ---------------------------------------------------------------------------

const SIDE: readonly AnatomyRegion[] = [
  {
    key: "side:trapezius",
    view: "side",
    label: "Traps",
    d: "M96 68 C104 76 112 84 120 90 L114 108 C106 100 98 92 92 84 Z",
  },
  {
    key: "side:deltoid_side",
    view: "side",
    label: "Side deltoid",
    d: "M92 92 C100 88 110 88 116 92 C119 100 119 112 116 120 C108 124 98 124 92 120 C89 110 89 100 92 92 Z",
  },
  {
    key: "side:pectoralis_major",
    view: "side",
    label: "Chest",
    d: "M78 100 C84 98 90 100 92 106 C93 118 92 132 88 142 C82 144 77 142 75 136 C74 122 75 109 78 100 Z",
  },
  {
    key: "side:biceps_brachii",
    view: "side",
    label: "Biceps",
    d: "M88 132 C92 130 95 131 96 135 C97 150 96 168 93 182 C90 184 87 183 86 180 C85 164 86 146 88 132 Z",
  },
  {
    key: "side:triceps_brachii",
    view: "side",
    label: "Triceps",
    d: "M110 132 C114 130 117 131 118 135 C119 150 118 168 115 182 C112 184 109 183 108 180 C107 164 108 146 110 132 Z",
  },
  {
    key: "side:latissimus_dorsi",
    view: "side",
    label: "Lats",
    d: "M118 130 C124 136 128 146 130 158 C130 180 128 204 124 224 C118 218 114 206 112 192 C110 170 112 146 118 130 Z",
  },
  {
    key: "side:rectus_abdominis",
    view: "side",
    label: "Abdominals",
    d: "M80 150 C84 149 88 149 89 151 C90 170 89 192 86 212 C84 226 82 236 80 240 C77 224 76 196 77 172 C78 162 79 154 80 150 Z",
  },
  {
    key: "side:obliques",
    view: "side",
    label: "Obliques",
    d: "M92 160 C96 159 100 160 101 163 C102 182 101 204 98 222 C95 224 92 223 91 220 C90 200 90 178 92 160 Z",
  },
  {
    key: "side:erector_spinae",
    view: "side",
    label: "Spinal erectors",
    d: "M112 150 C114 149 116 149 117 150 C118 180 117 212 115 240 C113 242 111 242 110 240 C109 210 110 178 112 150 Z",
  },
  {
    key: "side:gluteus_maximus",
    view: "side",
    label: "Glutes",
    d: "M108 246 C116 243 124 245 128 252 C131 266 130 286 124 300 C116 305 107 303 103 295 C101 278 103 258 108 246 Z",
  },
  {
    key: "side:quadriceps",
    view: "side",
    label: "Quadriceps",
    d: "M76 256 C83 253 91 254 94 259 C96 288 94 322 89 350 C84 354 78 353 75 347 C72 318 73 286 76 256 Z",
  },
  {
    key: "side:hamstrings",
    view: "side",
    label: "Hamstrings",
    d: "M102 316 C107 313 112 314 114 318 C116 340 114 364 110 384 C106 387 101 386 99 381 C97 358 98 334 102 316 Z",
  },
  {
    key: "side:gastrocnemius",
    view: "side",
    label: "Gastrocnemius",
    d: "M104 392 C109 390 113 391 115 395 C117 410 115 426 111 438 C106 440 102 438 101 433 C100 418 101 403 104 392 Z",
  },
  {
    key: "side:soleus",
    view: "side",
    label: "Soleus",
    d: "M92 400 C96 398 100 399 101 403 C102 416 101 432 98 444 C94 446 91 444 90 439 C89 425 90 410 92 400 Z",
  },
];

export const ANATOMY_REGIONS: readonly AnatomyRegion[] = [...FRONT, ...BACK, ...SIDE];

// ---------------------------------------------------------------------------
// Taxonomy → region mapping
// ---------------------------------------------------------------------------

export interface AnatomyTarget {
  muscleSlug: string;
  structureSlug?: string;
}

const SIDE_FALLBACKS: Record<string, readonly string[]> = {
  pectoralis_major: ["side:pectoralis_major"],
  deltoid_front: ["side:deltoid_side"],
  deltoid_side: ["side:deltoid_side"],
  deltoid_rear: ["side:deltoid_side"],
  biceps_brachii: ["side:biceps_brachii"],
  brachialis: ["side:biceps_brachii"],
  triceps_brachii: ["side:triceps_brachii"],
  latissimus_dorsi: ["side:latissimus_dorsi"],
  teres_major: ["side:latissimus_dorsi"],
  trapezius: ["side:trapezius"],
  rhomboid_major: ["side:trapezius"],
  rhomboid_minor: ["side:trapezius"],
  erector_spinae: ["side:erector_spinae"],
  rectus_abdominis: ["side:rectus_abdominis"],
  obliques: ["side:obliques"],
  obliques_internal: ["side:obliques"],
  transversus_abdominis: ["side:rectus_abdominis"],
  gluteus_maximus: ["side:gluteus_maximus"],
  gluteus_medius: ["side:gluteus_maximus"],
  gluteus_minimus: ["side:gluteus_maximus"],
  quadriceps: ["side:quadriceps"],
  hamstrings: ["side:hamstrings"],
  adductor_group: ["side:quadriceps"],
  gastrocnemius: ["side:gastrocnemius"],
  soleus: ["side:soleus"],
  brachioradialis: ["side:biceps_brachii"],
  forearm_flexors: ["side:biceps_brachii"],
  forearm_extensors: ["side:triceps_brachii"],
};

/** Structure-level overrides: (muscle, structure) → region keys per view. */
const STRUCTURE_REGIONS: Record<string, { front?: readonly string[]; back?: readonly string[]; side?: readonly string[] }> = {
  "pectoralis_major.clavicular_head": {
    front: ["front:pectoralis_major.clavicular_head.left", "front:pectoralis_major.clavicular_head.right"],
    side: ["side:pectoralis_major"],
  },
  "pectoralis_major.sternal_head": {
    front: ["front:pectoralis_major.sternal_head.left", "front:pectoralis_major.sternal_head.right"],
    side: ["side:pectoralis_major"],
  },
  "biceps_brachii.long_head": {
    front: ["front:biceps_brachii.long_head.left", "front:biceps_brachii.long_head.right"],
    side: ["side:biceps_brachii"],
  },
  "biceps_brachii.short_head": {
    front: ["front:biceps_brachii.short_head.left", "front:biceps_brachii.short_head.right"],
    side: ["side:biceps_brachii"],
  },
  "triceps_brachii.long_head": {
    back: ["back:triceps_brachii.long_head.left", "back:triceps_brachii.long_head.right"],
    side: ["side:triceps_brachii"],
  },
  "triceps_brachii.lateral_head": {
    back: ["back:triceps_brachii.lateral_head.left", "back:triceps_brachii.lateral_head.right"],
    side: ["side:triceps_brachii"],
  },
  "triceps_brachii.medial_head": {
    back: ["back:triceps_brachii.medial_head.left", "back:triceps_brachii.medial_head.right"],
    side: ["side:triceps_brachii"],
  },
  "trapezius.upper_region": { back: ["back:trapezius.upper_region"], front: ["front:trapezius.upper_region"], side: ["side:trapezius"] },
  "trapezius.middle_region": { back: ["back:trapezius.middle_region"], side: ["side:trapezius"] },
  "trapezius.lower_region": { back: ["back:trapezius.lower_region"], side: ["side:trapezius"] },
  "quadriceps.rectus_femoris": {
    front: ["front:quadriceps.rectus_femoris.left", "front:quadriceps.rectus_femoris.right"],
    side: ["side:quadriceps"],
  },
  "quadriceps.vastus_lateralis": {
    front: ["front:quadriceps.vastus_lateralis.left", "front:quadriceps.vastus_lateralis.right"],
    side: ["side:quadriceps"],
  },
  "quadriceps.vastus_medialis": {
    front: ["front:quadriceps.vastus_medialis.left", "front:quadriceps.vastus_medialis.right"],
    side: ["side:quadriceps"],
  },
  "quadriceps.vastus_intermedius": { front: ["front:quadriceps.rectus_femoris.left", "front:quadriceps.rectus_femoris.right"], side: ["side:quadriceps"] },
  "hamstrings.biceps_femoris": {
    back: ["back:hamstrings.biceps_femoris.left", "back:hamstrings.biceps_femoris.right"],
    side: ["side:hamstrings"],
  },
  "hamstrings.semitendinosus": {
    back: ["back:hamstrings.semitendinosus.left", "back:hamstrings.semitendinosus.right"],
    side: ["side:hamstrings"],
  },
  "hamstrings.semimembranosus": {
    back: ["back:hamstrings.semitendinosus.left", "back:hamstrings.semitendinosus.right"],
    side: ["side:hamstrings"],
  },
  "gastrocnemius.medial_head": {
    back: ["back:gastrocnemius.medial_head.left", "back:gastrocnemius.medial_head.right"],
    side: ["side:gastrocnemius"],
  },
  "gastrocnemius.lateral_head": {
    back: ["back:gastrocnemius.lateral_head.left", "back:gastrocnemius.lateral_head.right"],
    side: ["side:gastrocnemius"],
  },
};

const MUSCLE_REGIONS: Record<string, { front?: readonly string[]; back?: readonly string[]; side?: readonly string[] }> = {
  pectoralis_major: {
    front: [
      "front:pectoralis_major.clavicular_head.left",
      "front:pectoralis_major.clavicular_head.right",
      "front:pectoralis_major.sternal_head.left",
      "front:pectoralis_major.sternal_head.right",
    ],
    side: ["side:pectoralis_major"],
  },
  deltoid_front: { front: ["front:deltoid_front.left", "front:deltoid_front.right"], side: ["side:deltoid_side"] },
  deltoid_side: { front: ["front:deltoid_side.left", "front:deltoid_side.right"], back: ["back:deltoid_side.left", "back:deltoid_side.right"], side: ["side:deltoid_side"] },
  deltoid_rear: { back: ["back:deltoid_rear.left", "back:deltoid_rear.right"], side: ["side:deltoid_side"] },
  biceps_brachii: {
    front: [
      "front:biceps_brachii.long_head.left",
      "front:biceps_brachii.long_head.right",
      "front:biceps_brachii.short_head.left",
      "front:biceps_brachii.short_head.right",
    ],
    side: ["side:biceps_brachii"],
  },
  brachialis: { front: ["front:brachialis.left", "front:brachialis.right"], side: ["side:biceps_brachii"] },
  brachioradialis: { front: ["front:brachioradialis.left", "front:brachioradialis.right"], side: ["side:biceps_brachii"] },
  triceps_brachii: {
    back: [
      "back:triceps_brachii.long_head.left",
      "back:triceps_brachii.long_head.right",
      "back:triceps_brachii.lateral_head.left",
      "back:triceps_brachii.lateral_head.right",
      "back:triceps_brachii.medial_head.left",
      "back:triceps_brachii.medial_head.right",
    ],
    side: ["side:triceps_brachii"],
  },
  trapezius: {
    back: ["back:trapezius.upper_region", "back:trapezius.middle_region", "back:trapezius.lower_region"],
    front: ["front:trapezius.upper_region"],
    side: ["side:trapezius"],
  },
  rhomboid_major: { back: ["back:rhomboid_major"], side: ["side:trapezius"] },
  rhomboid_minor: { back: ["back:rhomboid_major"], side: ["side:trapezius"] },
  latissimus_dorsi: { back: ["back:latissimus_dorsi.left", "back:latissimus_dorsi.right"], side: ["side:latissimus_dorsi"] },
  teres_major: { back: ["back:teres_major.left", "back:teres_major.right"], side: ["side:latissimus_dorsi"] },
  erector_spinae: { back: ["back:erector_spinae.left", "back:erector_spinae.right"], side: ["side:erector_spinae"] },
  rectus_abdominis: { front: ["front:rectus_abdominis"], side: ["side:rectus_abdominis"] },
  obliques: { front: ["front:obliques.left", "front:obliques.right"], side: ["side:obliques"] },
  obliques_internal: { front: ["front:obliques.left", "front:obliques.right"], side: ["side:obliques"] },
  transversus_abdominis: { front: ["front:rectus_abdominis"], side: ["side:rectus_abdominis"] },
  quadriceps: {
    front: [
      "front:quadriceps.rectus_femoris.left",
      "front:quadriceps.rectus_femoris.right",
      "front:quadriceps.vastus_lateralis.left",
      "front:quadriceps.vastus_lateralis.right",
      "front:quadriceps.vastus_medialis.left",
      "front:quadriceps.vastus_medialis.right",
    ],
    side: ["side:quadriceps"],
  },
  adductor_group: { front: ["front:adductor_group.left", "front:adductor_group.right"], back: ["back:adductor_group.left", "back:adductor_group.right"], side: ["side:quadriceps"] },
  hamstrings: {
    back: [
      "back:hamstrings.biceps_femoris.left",
      "back:hamstrings.biceps_femoris.right",
      "back:hamstrings.semitendinosus.left",
      "back:hamstrings.semitendinosus.right",
    ],
    side: ["side:hamstrings"],
  },
  gluteus_maximus: { back: ["back:gluteus_maximus.left", "back:gluteus_maximus.right"], side: ["side:gluteus_maximus"] },
  gluteus_medius: { back: ["back:gluteus_medius.left", "back:gluteus_medius.right"], side: ["side:gluteus_maximus"] },
  gluteus_minimus: { back: ["back:gluteus_medius.left", "back:gluteus_medius.right"], side: ["side:gluteus_maximus"] },
  gastrocnemius: {
    back: [
      "back:gastrocnemius.medial_head.left",
      "back:gastrocnemius.medial_head.right",
      "back:gastrocnemius.lateral_head.left",
      "back:gastrocnemius.lateral_head.right",
    ],
    side: ["side:gastrocnemius"],
  },
  soleus: { back: ["back:soleus.left", "back:soleus.right"], side: ["side:soleus"] },
  forearm_flexors: { front: ["front:forearm_flexors.left", "front:forearm_flexors.right"], side: ["side:biceps_brachii"] },
  forearm_extensors: { back: ["back:forearm_extensors.left", "back:forearm_extensors.right"], side: ["side:triceps_brachii"] },
};

/**
 * Resolve a muscle (+optional structure) to atlas region keys for one view.
 * Structure keys win; then muscle keys; deep structures fall back to the
 * parent surface region. Returns [] when nothing maps (renderer hides then).
 */
export function resolveAnatomyRegions(target: AnatomyTarget, view: AnatomyView): readonly string[] {
  if (target.structureSlug) {
    const structured = STRUCTURE_REGIONS[`${target.muscleSlug}.${target.structureSlug}`];
    const regions = structured?.[view];
    if (regions && regions.length > 0) return regions;
  }
  const muscle = MUSCLE_REGIONS[target.muscleSlug];
  const regions = muscle?.[view];
  if (regions && regions.length > 0) return regions;
  if (view === "side") return SIDE_FALLBACKS[target.muscleSlug] ?? [];
  return [];
}

/** The views that can show this target at all, best first. */
export function viewsForTarget(target: AnatomyTarget): readonly AnatomyView[] {
  const scored = (["front", "back", "side"] as const).map((view) => ({
    view,
    count: resolveAnatomyRegions(target, view).length,
  }));
  return scored
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((entry) => entry.view);
}

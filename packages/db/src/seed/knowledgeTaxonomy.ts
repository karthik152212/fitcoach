import type {
  EquipmentCategory,
  MovementFunction,
  MuscleGroup,
  MuscleStructureKind,
} from "@fitcoach/domain";

/**
 * PHASE 2 KNOWLEDGE FIXTURES — part 1: taxonomy.
 *
 * Hand-written, first-party content (no third-party dataset, no imported
 * media, no anatomical illustration). These rows exist so the knowledge layer
 * is reviewable, testable and reproducible; they are NOT a claim that the
 * catalog is complete, and they carry no `external_sources` reference because
 * first-party rows simply have NULL source fields
 * (docs/DATABASE_DESIGN.md §10).
 *
 * The taxonomy is deliberately partial in one direction only: it covers the
 * structures a training system must reason about (heads and regions), and it
 * does not invent precision it cannot justify. Nothing here says an exercise
 * isolates a structure — only that it biases or contributes to it.
 */

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

export interface KnowledgeEquipment {
  slug: string;
  name: string;
  category: EquipmentCategory;
  /**
   * Progressive-onboarding group. The product asks about equipment in stages
   * ("Do you have a barbell?") rather than with one giant checklist, so each
   * piece carries the stage that surfaces it.
   */
  onboardingStage: "bodyweight_only" | "free_weights" | "bench_and_rack" | "cable_and_machine" | "specialised";
}

/**
 * Equipment identity is *functional*: "a cable station" rather than "the
 * machine at my gym", because the exercise catalog depends on what a movement
 * can be loaded with, not on a brand or a model.
 */
export const KNOWLEDGE_EQUIPMENT: readonly KnowledgeEquipment[] = [
  { slug: "bodyweight", name: "Bodyweight only", category: "bodyweight", onboardingStage: "bodyweight_only" },
  { slug: "resistance_bands", name: "Resistance bands", category: "bands", onboardingStage: "bodyweight_only" },
  { slug: "dumbbells", name: "Dumbbells", category: "dumbbell", onboardingStage: "free_weights" },
  { slug: "kettlebell", name: "Kettlebell", category: "kettlebell", onboardingStage: "free_weights" },
  { slug: "ez_bar", name: "EZ curl bar", category: "barbell", onboardingStage: "free_weights" },
  { slug: "barbell", name: "Barbell", category: "barbell", onboardingStage: "bench_and_rack" },
  { slug: "adjustable_bench", name: "Adjustable bench", category: "bench", onboardingStage: "bench_and_rack" },
  { slug: "squat_rack", name: "Squat rack", category: "rack", onboardingStage: "bench_and_rack" },
  { slug: "smith_machine", name: "Smith machine", category: "smith_machine", onboardingStage: "bench_and_rack" },
  { slug: "pull_up_bar", name: "Pull-up bar", category: "pull_up_bar", onboardingStage: "bodyweight_only" },
  { slug: "cable_machine", name: "Cable machine", category: "cable", onboardingStage: "cable_and_machine" },
  { slug: "lat_pulldown_machine", name: "Lat pulldown machine", category: "machine", onboardingStage: "cable_and_machine" },
  { slug: "chest_press_machine", name: "Chest press machine", category: "machine", onboardingStage: "cable_and_machine" },
  { slug: "pec_deck", name: "Pec deck", category: "machine", onboardingStage: "cable_and_machine" },
  { slug: "lateral_raise_machine", name: "Lateral raise machine", category: "machine", onboardingStage: "cable_and_machine" },
  { slug: "leg_press", name: "Leg press", category: "machine", onboardingStage: "cable_and_machine" },
  { slug: "leg_extension_machine", name: "Leg extension machine", category: "machine", onboardingStage: "cable_and_machine" },
  { slug: "leg_curl_machine", name: "Leg curl machine", category: "machine", onboardingStage: "cable_and_machine" },
  { slug: "hip_abduction_machine", name: "Hip abduction machine", category: "machine", onboardingStage: "cable_and_machine" },
  { slug: "calf_raise_machine", name: "Calf raise machine", category: "machine", onboardingStage: "cable_and_machine" },
  { slug: "assisted_pull_up_machine", name: "Assisted pull-up machine", category: "machine", onboardingStage: "specialised" },
];

// ---------------------------------------------------------------------------
// Muscles and their structures
// ---------------------------------------------------------------------------

export interface KnowledgeMuscleStructure {
  slug: string;
  name: string;
  kind: MuscleStructureKind;
  displayName: string;
  notes?: string;
}

export interface KnowledgeMuscle {
  slug: string;
  name: string;
  group: MuscleGroup;
  displayName: string;
  structures?: readonly KnowledgeMuscleStructure[];
}

/**
 * Heads and regions exist only where a training decision genuinely differs.
 * The biceps and triceps heads are the clear cases (a long-head-biased curl
 * and a short-position curl are complementary, not interchangeable); the
 * quadriceps portions are included because knee-extension variation is a real
 * selection axis; trapezius regions because "upper back work" is otherwise an
 * unhelpful label. Nothing else was added, because adding a structure the
 * knowledge layer cannot act on would be fake precision.
 */
export const KNOWLEDGE_MUSCLES: readonly KnowledgeMuscle[] = [
  {
    slug: "pectoralis_major",
    name: "pectoralis_major",
    group: "chest",
    displayName: "Chest",
    structures: [
      {
        slug: "clavicular_head",
        name: "clavicular_head",
        kind: "region",
        displayName: "Upper chest (clavicular)",
        notes:
          "Biased by pressing from an inclined or upright position; shares the sternal head's insertion but sits above the nipple line.",
      },
      {
        slug: "sternal_head",
        name: "sternal_head",
        kind: "region",
        displayName: "Mid chest (sternal)",
        notes: "The bulk of pressing from a flat or declined position.",
      },
    ],
  },
  { slug: "latissimus_dorsi", name: "latissimus_dorsi", group: "lats", displayName: "Lats" },
  { slug: "teres_major", name: "teres_major", group: "upper_back", displayName: "Teres major" },
  {
    slug: "trapezius",
    name: "trapezius",
    group: "traps",
    displayName: "Traps",
    structures: [
      { slug: "upper_region", name: "upper_region", kind: "region", displayName: "Upper traps" },
      { slug: "middle_region", name: "middle_region", kind: "region", displayName: "Mid traps" },
      { slug: "lower_region", name: "lower_region", kind: "region", displayName: "Lower traps" },
    ],
  },
  { slug: "rhomboid_major", name: "rhomboid_major", group: "upper_back", displayName: "Rhomboids" },
  { slug: "rhomboid_minor", name: "rhomboid_minor", group: "upper_back", displayName: "Rhomboids (minor)" },
  { slug: "erector_spinae", name: "erector_spinae", group: "lower_back", displayName: "Spinal erectors" },
  { slug: "deltoid_front", name: "deltoid_anterior", group: "front_delts", displayName: "Front delts" },
  { slug: "deltoid_side", name: "deltoid_lateral", group: "side_delts", displayName: "Side delts" },
  { slug: "deltoid_rear", name: "deltoid_posterior", group: "rear_delts", displayName: "Rear delts" },
  {
    slug: "biceps_brachii",
    name: "biceps_brachii",
    group: "biceps",
    displayName: "Biceps",
    structures: [
      {
        slug: "long_head",
        name: "long_head",
        kind: "head",
        displayName: "Long head",
        notes:
          "Biased when the shoulder is extended behind the torso and the elbow is long — an incline or high-hang curl. This is a bias, not isolation.",
      },
      {
        slug: "short_head",
        name: "short_head",
        kind: "head",
        displayName: "Short head",
        notes:
          "Contributes more when the shoulder stays neutral or flexed and the elbow stays bent — a preacher curl or a spider curl. Still a contribution.",
      },
    ],
  },
  { slug: "brachialis", name: "brachialis", group: "biceps", displayName: "Brachialis" },
  { slug: "brachioradialis", name: "brachioradialis", group: "biceps", displayName: "Brachioradialis" },
  {
    slug: "triceps_brachii",
    name: "triceps_brachii",
    group: "triceps",
    displayName: "Triceps",
    structures: [
      {
        slug: "long_head",
        name: "long_head",
        kind: "head",
        displayName: "Long head",
        notes:
          "Biased by overhead extensions and skull crushers, where the shoulder is flexed and the elbow long. Contribution, not isolation.",
      },
      {
        slug: "lateral_head",
        name: "lateral_head",
        kind: "head",
        displayName: "Lateral head",
        notes: "Carries a large share of extension work from most pressing and pushing variations.",
      },
      {
        slug: "medial_head",
        name: "medial_head",
        kind: "head",
        displayName: "Medial head",
        notes: "Visible distally at the elbow and relevant to close-grip work, but never claimed to be isolated.",
      },
    ],
  },
  {
    slug: "quadriceps",
    name: "quadriceps_femoris",
    group: "quadriceps",
    displayName: "Quadriceps",
    structures: [
      { slug: "rectus_femoris", name: "rectus_femoris", kind: "portion", displayName: "Rectus femoris" },
      { slug: "vastus_lateralis", name: "vastus_lateralis", kind: "portion", displayName: "Vastus lateralis" },
      { slug: "vastus_medialis", name: "vastus_medialis", kind: "portion", displayName: "Vastus medialis" },
      { slug: "vastus_intermedius", name: "vastus_intermedius", kind: "portion", displayName: "Vastus intermedius" },
    ],
  },
  {
    slug: "hamstrings",
    name: "hamstrings",
    group: "hamstrings",
    displayName: "Hamstrings",
    structures: [
      { slug: "biceps_femoris", name: "biceps_femoris", kind: "portion", displayName: "Biceps femoris" },
      { slug: "semitendinosus", name: "semitendinosus", kind: "portion", displayName: "Semitendinosus" },
      { slug: "semimembranosus", name: "semimembranosus", kind: "portion", displayName: "Semimembranosus" },
    ],
  },
  { slug: "gluteus_maximus", name: "gluteus_maximus", group: "glutes", displayName: "Glutes" },
  { slug: "gluteus_medius", name: "gluteus_medius", group: "glutes", displayName: "Gluteus medius" },
  { slug: "gluteus_minimus", name: "gluteus_minimus", group: "glutes", displayName: "Gluteus minimus" },
  { slug: "adductor_group", name: "adductor_group", group: "adductors", displayName: "Adductors" },
  {
    slug: "gastrocnemius",
    name: "gastrocnemius",
    group: "calves",
    displayName: "Calves (gastrocnemius)",
    structures: [
      { slug: "medial_head", name: "medial_head", kind: "head", displayName: "Gastrocnemius medial head" },
      { slug: "lateral_head", name: "lateral_head", kind: "head", displayName: "Gastrocnemius lateral head" },
    ],
  },
  { slug: "soleus", name: "soleus", group: "calves", displayName: "Soleus" },
  { slug: "rectus_abdominis", name: "rectus_abdominis", group: "abdominals", displayName: "Rectus abdominis" },
  { slug: "obliques", name: "obliquus_externus", group: "obliques", displayName: "Obliques (external)" },
  { slug: "obliques_internal", name: "obliquus_internalus", group: "obliques", displayName: "Obliques (internal)" },
  { slug: "transversus_abdominis", name: "transversus_abdominis", group: "abdominals", displayName: "Transverse abdominis" },
  { slug: "forearm_flexors", name: "forearm_flexors", group: "forearms", displayName: "Forearm flexors" },
  { slug: "forearm_extensors", name: "forearm_extensors", group: "forearms", displayName: "Forearm extensors" },
];

// ---------------------------------------------------------------------------
// Movement/function catalog
// ---------------------------------------------------------------------------

export interface KnowledgeMovementFunction {
  slug: MovementFunction;
  name: string;
  region: "shoulder" | "elbow" | "forearm" | "hip" | "knee" | "ankle" | "spine" | "trunk" | "general";
  description?: string;
}

/**
 * `exercises.movement_pattern` stays the coarse family label; this catalog is
 * the finer, multi-valued joint-action vocabulary. A movement legitimately is
 * several things at once (an incline press is an incline press AND a horizontal
 * press AND an elbow extension), which is exactly why this is a separate table.
 */
export const KNOWLEDGE_MOVEMENT_FUNCTIONS: readonly KnowledgeMovementFunction[] = [
  { slug: "horizontal_press", name: "Horizontal press", region: "shoulder", description: "Shoulder adduction and extension at a horizontal path." },
  { slug: "incline_press", name: "Incline press", region: "shoulder", description: "Horizontal press from an inclined torso, biasing the clavicular pectoralis." },
  { slug: "decline_press", name: "Decline press", region: "shoulder" },
  { slug: "vertical_press", name: "Vertical press", region: "shoulder", description: "Pressing performed overhead." },
  { slug: "dips", name: "Dips", region: "shoulder" },
  { slug: "vertical_pull", name: "Vertical pull", region: "shoulder", description: "Pulling down from above; the main lat-focused path." },
  { slug: "horizontal_pull", name: "Horizontal pull", region: "shoulder", description: "Rowing path toward the torso; mid-back and rear-deltoid leaning." },
  { slug: "straight_arm_pull", name: "Straight-arm pull", region: "shoulder", description: "Shoulder extension with a largely fixed elbow." },
  { slug: "shoulder_abduction", name: "Shoulder abduction", region: "shoulder", description: "Raising the arm out to the side; the lateral-deltoid action." },
  { slug: "shoulder_adduction", name: "Shoulder adduction", region: "shoulder", description: "Drawing the arm down and across toward the torso; the main lat action in presses and pulls." },
  { slug: "shoulder_flexion", name: "Shoulder flexion", region: "shoulder" },
  { slug: "shoulder_extension", name: "Shoulder extension", region: "shoulder" },
  { slug: "elbow_flexion", name: "Elbow flexion", region: "elbow" },
  { slug: "elbow_extension", name: "Elbow extension", region: "elbow" },
  { slug: "forearm_supination", name: "Forearm supination", region: "forearm" },
  { slug: "forearm_pronation", name: "Forearm pronation", region: "forearm" },
  { slug: "squat", name: "Squat", region: "knee" },
  { slug: "hinge", name: "Hinge", region: "hip" },
  { slug: "knee_extension", name: "Knee extension", region: "knee" },
  { slug: "knee_flexion", name: "Knee flexion", region: "knee" },
  { slug: "hip_flexion", name: "Hip flexion", region: "hip" },
  { slug: "hip_extension", name: "Hip extension", region: "hip" },
  { slug: "hip_abduction", name: "Hip abduction", region: "hip" },
  { slug: "hip_adduction", name: "Hip adduction", region: "hip" },
  { slug: "plantarflexion", name: "Plantarflexion", region: "ankle" },
  { slug: "trunk_flexion", name: "Trunk flexion", region: "trunk" },
  { slug: "trunk_extension", name: "Trunk extension", region: "spine" },
  { slug: "anti_extension", name: "Anti-extension", region: "trunk", description: "Resisting trunk extension while the spine stays neutral." },
  { slug: "anti_rotation", name: "Anti-rotation", region: "trunk", description: "Resisting trunk rotation under lateral load." },
  { slug: "lateral_flexion", name: "Lateral flexion", region: "trunk" },
  { slug: "shoulder_shrug", name: "Shoulder shrug", region: "shoulder" },
  { slug: "carry", name: "Loaded carry", region: "general" },
  { slug: "locomotion", name: "Locomotion", region: "general" },
];

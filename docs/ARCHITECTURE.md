# Technical Architecture v0.1

## Principle

The LLM is not the source of truth.

Deterministic domain logic calculates facts and constraints. The AI layer interprets those facts, handles natural-language input, explains decisions and chooses among validated interventions.

```text
Mobile/Web
   |
   v
API
   |
   +--> Domain / DB
   |
   +--> Fitness Core
   |      + muscle coverage
   |      + exercise selection
   |      + redundancy
   |      + progression
   |      + split generation
   |
   +--> Nutrition
   |      + food
   |      + meals
   |      + daily totals
   |
   +--> Activity
   |      + steps
   |      + cardio
   |
   +--> Diagnosis
   |      + trend detection
   |      + goal alignment
   |      + problem detection
   |      + intervention selection
   |
   +--> AI
          + natural language parsing
          + explanations
          + coaching
          + recommendation presentation
```

## Long-term data model

- users
- profiles
- goals
- physique_targets
- gym_equipment
- exercises
- muscles
- exercise_muscles
- training_plans
- workouts
- sets
- body_measurements
- activity_records
- foods
- food_sources
- recipes
- meals
- meal_items
- daily_nutrition
- diagnoses
- interventions
- intervention_outcomes
- recommendations

## Intervention record

An intervention should capture:
- problem
- evidence
- goal
- action
- expected outcome
- review date
- actual outcome
- success/failure/uncertain status

This is required for adaptive coaching.

## Database direction

Use a relational database for the production system. The current openGym JSON-file approach is useful as a lightweight reference, but it is not sufficient for the connected historical model required here.

## Open-source strategy

Do not make the product a fork with a permanent dependency on openGym.

Use:
- compatible open-source libraries/components where their licenses permit;
- independent reimplementations of behavior where appropriate;
- separately licensed datasets only when redistribution/usage rights are clear.

Maintain provenance for every third-party component and dataset.

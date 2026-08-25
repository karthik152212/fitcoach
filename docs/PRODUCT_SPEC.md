# FitCoach Product Specification v0.1

## Core promise

Understand the person, their goal, their available gym, what they actually do and eat, what happens to their body, and then solve the most important problem affecting progress.

## User onboarding

1. Personal profile
   - age
   - sex
   - height
   - weight
   - waist
   - optional body measurements
   - training experience
   - training days
   - session duration
   - limitations/injuries

2. Goal
   - bodybuilding
   - aesthetic / V-taper
   - lean/recomposition
   - athletic
   - strength
   - general fitness
   - user-defined priorities

3. Gym inventory
   - guided equipment-by-equipment interview
   - exercise availability derived from equipment
   - substitutions for unavailable equipment

## Data collected

### Training
- plans/splits
- exercises
- sets/reps/load
- RIR/RPE
- duration
- cardio
- exercise substitutions
- notes

### Body
- weight
- waist
- chest
- shoulders
- arms
- thighs
- calves
- optional photos
- measurement quality/context

### Activity
- steps
- walking
- cardio sessions
- wearable/Health Connect imports later

### Nutrition
- foods
- quantities
- meals
- calories
- protein
- carbohydrates
- fat
- fiber
- recipes
- user-created foods
- source and confidence for estimates

### Coaching
- diagnoses
- recommendations
- interventions
- expected outcomes
- observed outcomes
- intervention status

## Coaching principles

1. Never judge a food as morally good or bad.
2. Never assume more steps are automatically better.
3. Never compensate for one food choice with punitive exercise.
4. Use trends rather than single noisy measurements.
5. Account for indirect training stimulus.
6. Minimize redundant exercise volume.
7. Prefer the smallest intervention likely to solve the problem.
8. If the plan is working, say so and do not change it unnecessarily.
9. Explain every material recommendation.
10. Reassess interventions against subsequent real-world data.

## Example

Goal: aesthetic / V-taper.

If chest grows while waist grows disproportionately:
- do not simply celebrate chest growth;
- check weight, nutrition, activity, training and measurement trends;
- determine whether the waist trend is real;
- choose an appropriate intervention;
- record the intervention;
- reassess after a defined interval.

If a user eats ice cream but remains within the daily calorie target:
- no compensation is required;
- check protein and other targets;
- suggest a protein-rich option if needed.

If calories are high but weekly trajectory is still appropriate:
- do not overreact to one day;
- use the weekly/rolling trend.

## MVP

### Phase 1
- profile/goals
- equipment inventory
- exercise/muscle model
- workout logging
- split generation
- progression
- body weight/measurements

### Phase 2
- nutrition database
- meal logging
- calories/protein
- steps/activity
- diagnosis engine
- intervention history

### Phase 3
- AI coach
- Health Connect/wearables
- barcode scanning
- recipes/restaurant foods
- richer recovery data

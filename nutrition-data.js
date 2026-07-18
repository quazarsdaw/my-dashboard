(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NutritionData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function range(min, max) {
    return { min: min, max: max };
  }

  function ingredient(id, name, amount, unit, category) {
    return { id: id, name: name, amount: amount, unit: unit, category: category };
  }

  function meal(config) {
    return {
      id: config.id,
      source: 'seed',
      mealType: config.mealType,
      title: config.title,
      tags: config.tags || [],
      prepMinutes: range(config.prep[0], config.prep[1]),
      caloriesApprox: range(config.calories[0], config.calories[1]),
      proteinApprox: range(config.protein[0], config.protein[1]),
      estimatedCostRub: range(config.cost[0], config.cost[1]),
      ingredients: config.ingredients,
      instructions: config.instructions,
      notes: config.notes || ''
    };
  }

  var meals = [
    meal({
      id: 'seed-breakfast-oatmeal-large',
      mealType: 'breakfast',
      title: 'большая овсянка',
      tags: ['дома', 'быстро'],
      prep: [7, 8], calories: [720, 760], protein: [35, 37], cost: [130, 170],
      ingredients: [
        ingredient('oats', 'овсяные хлопья', 70, 'г', 'bases'),
        ingredient('milk', 'молоко', 300, 'мл', 'dairy'),
        ingredient('greek-yogurt', 'греческий йогурт', 150, 'г', 'dairy'),
        ingredient('banana', 'банан', 1, 'шт', 'produce'),
        ingredient('nuts', 'орехи', 15, 'г', 'fats')
      ],
      instructions: [
        'свари овсянку на молоке или залей её горячим молоком',
        'добавь йогурт, банан и орехи перед подачей'
      ]
    }),
    meal({
      id: 'seed-breakfast-cottage-bowl',
      mealType: 'breakfast',
      title: 'творожная миска',
      tags: ['дома', 'без готовки'],
      prep: [3, 5], calories: [700, 720], protein: [40, 45], cost: [170, 220],
      ingredients: [
        ingredient('cottage-cheese', 'творог', 180, 'г', 'dairy'),
        ingredient('plain-yogurt', 'натуральный йогурт', 100, 'г', 'dairy'),
        ingredient('oats', 'овсяные хлопья', 40, 'г', 'bases'),
        ingredient('banana', 'банан', 1, 'шт', 'produce'),
        ingredient('berries', 'ягоды', 100, 'г', 'produce'),
        ingredient('nuts', 'орехи', 15, 'г', 'fats')
      ],
      instructions: [
        'смешай творог и йогурт',
        'добавь овсянку, банан, ягоды и орехи'
      ]
    }),
    meal({
      id: 'seed-breakfast-eggs-cottage',
      mealType: 'breakfast',
      title: 'яйца, творог и цельнозерновой хлеб',
      tags: ['дома', 'сытно'],
      prep: [8, 10], calories: [700, 800], protein: [40, 45], cost: [190, 240],
      ingredients: [
        ingredient('eggs', 'яйца', 2, 'шт', 'protein'),
        ingredient('cottage-cheese', 'творог', 100, 'г', 'dairy'),
        ingredient('wholegrain-bread', 'цельнозерновой хлеб', 90, 'г', 'bases'),
        ingredient('fresh-vegetables', 'свежие овощи', 225, 'г', 'produce'),
        ingredient('fruit', 'фрукт', 1, 'шт', 'produce'),
        ingredient('butter', 'сливочное масло', 10, 'г', 'fats')
      ],
      instructions: [
        'приготовь яйца на небольшом количестве масла',
        'подай с творогом, хлебом, овощами и фруктом'
      ],
      notes: 'чередуй с завтраками без жарки, не используй каждый день'
    }),
    meal({
      id: 'seed-breakfast-has-hearty',
      mealType: 'breakfast',
      title: 'сытный завтрак в has',
      tags: ['вне дома', 'has'],
      prep: [0, 5], calories: [700, 850], protein: [30, 40], cost: [320, 450],
      ingredients: [
        ingredient('has-breakfast', 'сытный завтрак в has', 1, 'порция', 'other')
      ],
      instructions: [
        'выбери сытный завтрак с яйцами или другим источником белка',
        'по возможности добавь овощи и напиток без лишнего сахара'
      ],
      notes: 'состав и показатели зависят от фактического блюда'
    }),
    meal({
      id: 'seed-breakfast-has-oatmeal',
      mealType: 'breakfast',
      title: 'овсянка в has с домашними добавками',
      tags: ['вне дома', 'has'],
      prep: [0, 5], calories: [650, 760], protein: [25, 35], cost: [240, 340],
      ingredients: [
        ingredient('has-oatmeal', 'овсянка в has', 1, 'порция', 'other'),
        ingredient('plain-yogurt', 'натуральный йогурт', 150, 'г', 'dairy'),
        ingredient('banana', 'банан', 1, 'шт', 'produce'),
        ingredient('nuts', 'орехи', 15, 'г', 'fats')
      ],
      instructions: [
        'возьми овсянку без тяжёлого сладкого топпинга',
        'добавь заранее взятые йогурт, банан и орехи'
      ]
    }),
    meal({
      id: 'seed-breakfast-has-turkey-sandwich',
      mealType: 'breakfast',
      title: 'сэндвич с индейкой, йогурт и фрукт',
      tags: ['вне дома', 'has'],
      prep: [0, 5], calories: [650, 780], protein: [35, 45], cost: [300, 420],
      ingredients: [
        ingredient('has-turkey-sandwich', 'сэндвич с индейкой', 1, 'порция', 'other'),
        ingredient('plain-yogurt', 'натуральный йогурт', 200, 'г', 'dairy'),
        ingredient('fruit', 'фрукт', 1, 'шт', 'produce')
      ],
      instructions: [
        'выбери сэндвич с индейкой вместо колбасы',
        'добавь йогурт или кефир и фрукт'
      ]
    }),
    meal({
      id: 'seed-lunch-chicken-buckwheat',
      mealType: 'lunch',
      title: 'курица, гречка и овощи',
      tags: ['заготовка', 'контейнер'],
      prep: [25, 35], calories: [780, 800], protein: [43, 46], cost: [190, 240],
      ingredients: [
        ingredient('chicken-thigh', 'куриное бедро без кости', 150, 'г', 'protein'),
        ingredient('buckwheat', 'гречка', 100, 'г', 'bases'),
        ingredient('mixed-vegetables', 'овощи', 250, 'г', 'produce'),
        ingredient('vegetable-oil', 'растительное масло', 15, 'мл', 'fats')
      ],
      instructions: [
        'отвари гречку до готовности',
        'запеки или обжарь курицу и овощи',
        'разложи по контейнерам с маслом или соусом отдельно'
      ]
    }),
    meal({
      id: 'seed-lunch-turkey-pasta',
      mealType: 'lunch',
      title: 'паста с индейкой и томатами',
      tags: ['заготовка', 'контейнер'],
      prep: [25, 35], calories: [850, 900], protein: [48, 52], cost: [230, 290],
      ingredients: [
        ingredient('turkey-mince', 'фарш из индейки', 150, 'г', 'protein'),
        ingredient('pasta', 'паста', 110, 'г', 'bases'),
        ingredient('canned-tomatoes', 'томаты в собственном соку', 200, 'г', 'produce'),
        ingredient('mixed-vegetables', 'овощи', 150, 'г', 'produce'),
        ingredient('hard-cheese', 'твёрдый сыр', 15, 'г', 'dairy'),
        ingredient('vegetable-oil', 'растительное масло', 10, 'мл', 'fats')
      ],
      instructions: [
        'отвари пасту до состояния аль денте',
        'приготовь индейку с томатами и овощами',
        'смешай порцию перед едой и добавь сыр'
      ]
    }),
    meal({
      id: 'seed-lunch-beef-rice',
      mealType: 'lunch',
      title: 'говядина, рис и овощи',
      tags: ['заготовка', 'контейнер'],
      prep: [30, 40], calories: [850, 880], protein: [38, 42], cost: [270, 340],
      ingredients: [
        ingredient('beef', 'говядина', 140, 'г', 'protein'),
        ingredient('rice', 'рис', 110, 'г', 'bases'),
        ingredient('mixed-vegetables', 'овощи', 250, 'г', 'produce'),
        ingredient('vegetable-oil', 'растительное масло', 15, 'мл', 'fats')
      ],
      instructions: [
        'отвари рис',
        'быстро обжарь говядину и овощи',
        'разложи по контейнерам и остуди перед холодильником'
      ]
    }),
    meal({
      id: 'seed-lunch-mackerel-potato',
      mealType: 'lunch',
      title: 'жирная рыба с картофелем',
      tags: ['рыба', 'дома'],
      prep: [30, 40], calories: [800, 850], protein: [40, 45], cost: [250, 330],
      ingredients: [
        ingredient('mackerel', 'скумбрия или другая жирная рыба', 160, 'г', 'protein'),
        ingredient('potato', 'картофель', 425, 'г', 'bases'),
        ingredient('fresh-vegetables', 'свежие овощи', 250, 'г', 'produce'),
        ingredient('vegetable-oil', 'растительное масло', 10, 'мл', 'fats')
      ],
      instructions: [
        'запеки рыбу и картофель на одном противне',
        'подай со свежими овощами'
      ]
    }),
    meal({
      id: 'seed-dinner-white-fish-potato',
      mealType: 'dinner',
      title: 'белая рыба, картофель и салат',
      tags: ['ужин', 'рыба'],
      prep: [25, 35], calories: [750, 820], protein: [45, 50], cost: [260, 330],
      ingredients: [
        ingredient('white-fish', 'филе белой рыбы', 190, 'г', 'protein'),
        ingredient('potato', 'картофель', 425, 'г', 'bases'),
        ingredient('fresh-vegetables', 'овощи для салата', 300, 'г', 'produce'),
        ingredient('vegetable-oil', 'растительное масло', 18, 'мл', 'fats')
      ],
      instructions: [
        'запеки рыбу и картофель',
        'собери большой салат и добавь масло перед подачей'
      ]
    }),
    meal({
      id: 'seed-dinner-chicken-rice',
      mealType: 'dinner',
      title: 'курица, рис и овощи',
      tags: ['ужин', 'быстро'],
      prep: [20, 30], calories: [820, 880], protein: [45, 50], cost: [220, 280],
      ingredients: [
        ingredient('chicken-breast', 'куриная грудка', 140, 'г', 'protein'),
        ingredient('rice', 'рис', 105, 'г', 'bases'),
        ingredient('mixed-vegetables', 'овощи', 300, 'г', 'produce'),
        ingredient('vegetable-oil', 'растительное масло', 18, 'мл', 'fats'),
        ingredient('plain-yogurt', 'натуральный йогурт', 100, 'г', 'dairy')
      ],
      instructions: [
        'отвари рис и приготовь курицу',
        'добавь овощи и подай с йогуртовым соусом'
      ]
    }),
    meal({
      id: 'seed-dinner-lentil-chicken',
      mealType: 'dinner',
      title: 'чечевица, курица и томаты',
      tags: ['ужин', 'одна кастрюля'],
      prep: [25, 35], calories: [820, 880], protein: [48, 52], cost: [210, 270],
      ingredients: [
        ingredient('lentils', 'чечевица', 80, 'г', 'bases'),
        ingredient('chicken-thigh', 'куриное бедро без кости', 100, 'г', 'protein'),
        ingredient('canned-tomatoes', 'томаты в собственном соку', 200, 'г', 'produce'),
        ingredient('mixed-vegetables', 'овощи', 200, 'г', 'produce'),
        ingredient('vegetable-oil', 'растительное масло', 15, 'мл', 'fats'),
        ingredient('wholegrain-bread', 'цельнозерновой хлеб', 70, 'г', 'bases')
      ],
      instructions: [
        'потуши курицу с овощами и томатами',
        'добавь чечевицу и воду, доведи до готовности',
        'подай с хлебом'
      ]
    }),
    meal({
      id: 'seed-dinner-eggs-potato',
      mealType: 'dinner',
      title: 'яйца, картофель, творог и овощи',
      tags: ['ужин', 'запасной вариант'],
      prep: [15, 25], calories: [800, 830], protein: [43, 47], cost: [180, 230],
      ingredients: [
        ingredient('eggs', 'яйца', 2, 'шт', 'protein'),
        ingredient('cottage-cheese', 'творог', 100, 'г', 'dairy'),
        ingredient('potato', 'картофель', 300, 'г', 'bases'),
        ingredient('fresh-vegetables', 'свежие овощи', 300, 'г', 'produce'),
        ingredient('wholegrain-bread', 'цельнозерновой хлеб', 50, 'г', 'bases'),
        ingredient('vegetable-oil', 'растительное масло', 10, 'мл', 'fats')
      ],
      instructions: [
        'разогрей заранее приготовленный картофель',
        'приготовь яйца и подай с творогом, овощами и хлебом'
      ]
    }),
    meal({
      id: 'seed-extra-banana-nuts',
      mealType: 'extra',
      title: 'банан и орехи',
      tags: ['тренировка', 'с собой'],
      prep: [1, 2], calories: [230, 270], protein: [4, 6], cost: [70, 100],
      ingredients: [
        ingredient('banana', 'банан', 1, 'шт', 'produce'),
        ingredient('nuts', 'орехи', 20, 'г', 'fats')
      ],
      instructions: ['возьми банан и порцию орехов до или после тренировки']
    }),
    meal({
      id: 'seed-extra-milk-fruit',
      mealType: 'extra',
      title: 'молоко и фрукт',
      tags: ['тренировка', 'быстро'],
      prep: [1, 2], calories: [220, 280], protein: [9, 12], cost: [80, 110],
      ingredients: [
        ingredient('milk', 'молоко', 300, 'мл', 'dairy'),
        ingredient('fruit', 'фрукт', 1, 'шт', 'produce')
      ],
      instructions: ['выпей молоко и съешь фрукт рядом с тренировкой']
    }),
    meal({
      id: 'seed-extra-grain',
      mealType: 'extra',
      title: 'дополнительная порция крупы',
      tags: ['тренировка', 'к основному блюду'],
      prep: [10, 20], calories: [180, 230], protein: [4, 7], cost: [25, 45],
      ingredients: [
        ingredient('rice', 'рис или другая крупа', 55, 'г', 'bases')
      ],
      instructions: ['добавь порцию готовой крупы к обеду или ужину']
    })
  ];

  var plan14 = {
    id: 'plan-14-v1',
    title: 'базовый рацион на 14 дней',
    days: [
      { day: 1, meals: { breakfast: 'seed-breakfast-oatmeal-large', lunch: 'seed-lunch-chicken-buckwheat', dinner: 'seed-dinner-white-fish-potato' } },
      { day: 2, meals: { breakfast: 'seed-breakfast-cottage-bowl', lunch: 'seed-lunch-chicken-buckwheat', dinner: 'seed-dinner-lentil-chicken' } },
      { day: 3, meals: { breakfast: 'seed-breakfast-eggs-cottage', lunch: 'seed-lunch-chicken-buckwheat', dinner: 'seed-dinner-chicken-rice' } },
      { day: 4, meals: { breakfast: 'seed-breakfast-has-hearty', lunch: 'seed-lunch-turkey-pasta', dinner: 'seed-dinner-white-fish-potato' } },
      { day: 5, meals: { breakfast: 'seed-breakfast-oatmeal-large', lunch: 'seed-lunch-turkey-pasta', dinner: 'seed-dinner-lentil-chicken' } },
      { day: 6, meals: { breakfast: 'seed-breakfast-cottage-bowl', lunch: 'seed-lunch-turkey-pasta', dinner: 'seed-dinner-eggs-potato' } },
      { day: 7, meals: { breakfast: 'seed-breakfast-oatmeal-large', lunch: 'seed-lunch-mackerel-potato', dinner: 'seed-dinner-chicken-rice' } },
      { day: 8, meals: { breakfast: 'seed-breakfast-eggs-cottage', lunch: 'seed-lunch-beef-rice', dinner: 'seed-dinner-white-fish-potato' } },
      { day: 9, meals: { breakfast: 'seed-breakfast-oatmeal-large', lunch: 'seed-lunch-beef-rice', dinner: 'seed-dinner-lentil-chicken' } },
      { day: 10, meals: { breakfast: 'seed-breakfast-cottage-bowl', lunch: 'seed-lunch-beef-rice', dinner: 'seed-dinner-chicken-rice' } },
      { day: 11, meals: { breakfast: 'seed-breakfast-has-oatmeal', lunch: 'seed-lunch-chicken-buckwheat', dinner: 'seed-dinner-eggs-potato' } },
      { day: 12, meals: { breakfast: 'seed-breakfast-oatmeal-large', lunch: 'seed-lunch-chicken-buckwheat', dinner: 'seed-dinner-white-fish-potato' } },
      { day: 13, meals: { breakfast: 'seed-breakfast-cottage-bowl', lunch: 'seed-lunch-chicken-buckwheat', dinner: 'seed-dinner-lentil-chicken' } },
      { day: 14, meals: { breakfast: 'seed-breakfast-eggs-cottage', lunch: 'seed-lunch-mackerel-potato', dinner: 'seed-dinner-chicken-rice' } }
    ]
  };

  var trainingExtras = [
    { id: 'extra-banana-nuts', mealId: 'seed-extra-banana-nuts' },
    { id: 'extra-milk-fruit', mealId: 'seed-extra-milk-fruit' },
    { id: 'extra-grain', mealId: 'seed-extra-grain' }
  ];

  var cookingSessions = {
    1: [
      {
        id: 'week-1-main', kind: 'main', title: 'основная заготовка на неделю 1',
        scheduleLabel: 'воскресенье', durationLabel: '≈80–100 мин',
        steps: [
          { id: 'heat', title: 'разогреть духовку и поставить воду для круп' },
          { id: 'buckwheat', title: 'сварить три порции гречки' },
          { id: 'chicken', title: 'запечь курицу для трёх обедов' },
          { id: 'turkey', title: 'приготовить три порции индейки в томатах' },
          { id: 'pasta', title: 'отварить пасту и не смешивать с соусом до хранения' },
          { id: 'containers', title: 'остудить и разложить шесть обедов по контейнерам' }
        ]
      },
      {
        id: 'week-1-short', kind: 'short', title: 'короткое обновление на неделю 1',
        scheduleLabel: 'середина недели', durationLabel: '≈35–50 мин',
        steps: [
          { id: 'rice', title: 'сварить рис на ближайшие ужины' },
          { id: 'potato', title: 'запечь картофель на две подачи' },
          { id: 'lentils', title: 'приготовить две порции чечевицы с курицей' },
          { id: 'defrost', title: 'переложить рыбу для разморозки в холодильник' },
          { id: 'fresh', title: 'вымыть овощи и подготовить основу для салатов' }
        ]
      }
    ],
    2: [
      {
        id: 'week-2-main', kind: 'main', title: 'основная заготовка на неделю 2',
        scheduleLabel: 'воскресенье', durationLabel: '≈80–100 мин',
        steps: [
          { id: 'heat', title: 'разогреть духовку и освободить контейнеры' },
          { id: 'rice', title: 'сварить рис для трёх обедов с говядиной' },
          { id: 'beef', title: 'приготовить говядину и овощи на три обеда' },
          { id: 'buckwheat', title: 'сварить три порции гречки' },
          { id: 'chicken', title: 'запечь курицу для обедов второй половины недели' },
          { id: 'containers', title: 'остудить и подписать шесть контейнеров' }
        ]
      },
      {
        id: 'week-2-short', kind: 'short', title: 'короткое обновление на неделю 2',
        scheduleLabel: 'середина недели', durationLabel: '≈35–50 мин',
        steps: [
          { id: 'potato', title: 'запечь картофель на ближайшие ужины' },
          { id: 'lentils', title: 'приготовить две порции чечевицы с курицей' },
          { id: 'rice', title: 'обновить запас риса для ужинов' },
          { id: 'defrost', title: 'разморозить белую и жирную рыбу по плану' },
          { id: 'fresh', title: 'подготовить свежие овощи и йогуртовый соус' }
        ]
      }
    ]
  };

  var ingredientCategories = {
    protein: 'белковые продукты',
    bases: 'крупы и основы',
    produce: 'овощи и фрукты',
    dairy: 'молочные продукты',
    fats: 'жиры',
    other: 'прочее'
  };

  var ingredientPrices = {
    'oats::г': 180,
    'milk::мл': 100,
    'greek-yogurt::г': 500,
    'banana::шт': 25,
    'nuts::г': 1200,
    'cottage-cheese::г': 500,
    'plain-yogurt::г': 350,
    'berries::г': 600,
    'eggs::шт': 13,
    'wholegrain-bread::г': 300,
    'fresh-vegetables::г': 300,
    'fruit::шт': 80,
    'butter::г': 900,
    'chicken-thigh::г': 500,
    'buckwheat::г': 180,
    'mixed-vegetables::г': 250,
    'vegetable-oil::мл': 180,
    'turkey-mince::г': 650,
    'pasta::г': 200,
    'canned-tomatoes::г': 230,
    'hard-cheese::г': 1000,
    'beef::г': 900,
    'rice::г': 180,
    'mackerel::г': 450,
    'potato::г': 70,
    'white-fish::г': 700,
    'chicken-breast::г': 550,
    'lentils::г': 250
  };

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  return deepFreeze({
    schemaVersion: 1,
    meals: meals,
    plan14: plan14,
    trainingExtras: trainingExtras,
    cookingSessions: cookingSessions,
    ingredientCategories: ingredientCategories,
    ingredientPrices: ingredientPrices,
    mealTypeLabels: {
      breakfast: 'завтрак',
      lunch: 'обед',
      dinner: 'ужин',
      extra: 'дополнение'
    }
  });
});

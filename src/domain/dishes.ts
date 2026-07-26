/**
 * The dish catalog — the app's own knowledge of common Indian (and Indian
 * restaurant) food, so an owner building a menu types a few letters and picks a
 * ready-made dish instead of writing out its name, description, photo and veg
 * dot. All they have to add is their price.
 *
 * This is a FLAT SEARCH INDEX, not a picklist: it is far too big to render as
 * chips or tiles. Nothing shows until the owner types (see `searchDishes`) —
 * "pane" surfaces Paneer Butter Masala, Matar Paneer, Shahi Paneer…
 *
 * Storage: a plain file for now, moving to the database later. The shape below
 * IS the future row shape (`id` is the stable key), so the move is a swap of
 * `searchDishes` behind the same call — nothing in the UI changes.
 *
 * Photos are placeholders (see `dishImage`) until the backend brings real,
 * licensed dish photography; a `photo` set explicitly on a dish always wins.
 */

import { type FoodMenuSection, getFoodSection } from './foodMenu';

export interface Dish {
  /** Stable key — becomes the primary key when this moves to the database. */
  id: string;
  name: string;
  /** Menu section this belongs to — a FOOD_MENU_SECTIONS id. */
  sectionId: string;
  /** Section subcategory, where the section has them (Beverages › Tea). */
  subcategory?: string;
  isVeg: boolean;
  description: string;
  /** Real photo URL once we have one; otherwise `dishImage` fills in. */
  photo?: string;
  /** Extra words people search by that aren't in the name (e.g. "chai" → Tea). */
  aka?: string[];
}

/** Compact row form — keeps the catalog readable and diffable as it grows. */
type Row = [name: string, isVeg: boolean, description: string, aka?: string[]];

function section(sectionId: string, subcategory: string | undefined, rows: Row[]): Dish[] {
  return rows.map(([name, isVeg, description, aka]) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    name,
    sectionId,
    subcategory,
    isVeg,
    description,
    aka,
  }));
}

export const DISH_CATALOG: Dish[] = [
  ...section('appetizers', undefined, [
    ['Paneer Tikka', true, 'Cottage cheese cubes marinated in spiced yogurt, charred in the tandoor.'],
    ['Paneer 65', true, 'Crisp fried paneer tossed with curry leaves, chilli and garlic.'],
    ['Chilli Paneer', true, 'Indo-Chinese paneer tossed with peppers, onion and soy-chilli sauce.'],
    ['Malai Paneer Tikka', true, 'Paneer in a mild cream, cheese and cardamom marinade.'],
    ['Achari Paneer Tikka', true, 'Paneer marinated in tangy pickling spices, grilled in the tandoor.'],
    ['Hara Bhara Kabab', true, 'Spinach, peas and potato patties, pan-fried till crisp.'],
    ['Dahi Ke Kebab', true, 'Melt-in-the-mouth kebabs of hung curd, chilli and cashew.'],
    ['Crispy Corn', true, 'Golden fried sweet corn tossed with pepper, chilli and herbs.'],
    ['Honey Chilli Potato', true, 'Crisp potato batons glazed in honey, chilli and sesame.'],
    ['Veg Manchurian Dry', true, 'Fried vegetable dumplings tossed in a dark garlic-soy sauce.'],
    ['Chilli Mushroom', true, 'Button mushrooms wok-tossed with capsicum and chilli sauce.'],
    ['Mushroom Tikka', true, 'Mushrooms marinated in spiced yogurt and grilled.'],
    ['Soya Chaap Tikka', true, 'Soya chaap sticks marinated in tandoori masala and grilled.'],
    ['Malai Chaap', true, 'Soya chaap in a rich cream and cheese marinade.'],
    ['Veg Spring Roll', true, 'Crisp rolls stuffed with shredded vegetables and noodles.'],
    ['Samosa', true, 'Fried pastry stuffed with spiced potato and peas.'],
    ['Aloo Tikki', true, 'Shallow-fried spiced potato patties, served with chutney.'],
    ['Onion Pakoda', true, 'Sliced onion fritters in spiced gram-flour batter.', ['bhaji']],
    ['Paneer Pakoda', true, 'Paneer slices in gram-flour batter, deep fried.'],
    ['Cheese Balls', true, 'Crumb-fried molten cheese bites.'],
    ['French Fries', true, 'Classic salted crisp-fried potato fingers.'],
    ['Peri Peri Fries', true, 'Fries tossed in tangy peri peri seasoning.'],
    ['Cheesy Nachos', true, 'Corn nachos loaded with cheese sauce, salsa and jalapeños.'],
    ['Chicken Tikka', false, 'Boneless chicken marinated in spiced yogurt, charred in the tandoor.'],
    ['Chicken Malai Tikka', false, 'Boneless chicken in a mild cream, cheese and cardamom marinade.'],
    ['Tandoori Chicken', false, 'Half or full chicken marinated in tandoori masala and smoked.'],
    ['Chicken 65', false, 'Fiery South-Indian fried chicken with curry leaves and chilli.'],
    ['Chilli Chicken', false, 'Indo-Chinese chicken tossed with peppers and soy-chilli sauce.'],
    ['Chicken Lollipop', false, 'Frenched chicken wings, fried and tossed in a hot sauce.'],
    ['Chicken Seekh Kebab', false, 'Minced chicken skewers grilled in the tandoor.'],
    ['Chicken Wings', false, 'Fried wings glazed in barbecue or peri peri sauce.'],
    ['Mutton Seekh Kebab', false, 'Spiced minced mutton skewers grilled in the tandoor.'],
    ['Mutton Galouti Kebab', false, 'Melt-in-the-mouth Lucknowi minced-mutton patties.'],
    ['Fish Tikka', false, 'Boneless fish marinated in ajwain and spices, tandoor grilled.'],
    ['Fish Fry', false, 'Fish fillets in a rava-and-spice crust, shallow fried.'],
    ['Prawn Koliwada', false, 'Crisp fried prawns in a tangy Koliwada masala.'],
    ['Egg Chilli', false, 'Boiled eggs wok-tossed with onion, capsicum and chilli sauce.'],
    ['Chicken Spring Roll', false, 'Crisp rolls stuffed with shredded chicken and noodles.'],
  ]),
  ...section('soups', undefined, [
    ['Tomato Soup', true, 'Creamy tomato soup finished with butter and croutons.'],
    ['Sweet Corn Soup', true, 'Light corn and vegetable broth, mildly sweet.'],
    ['Veg Manchow Soup', true, 'Spicy Indo-Chinese soup topped with fried noodles.'],
    ['Hot and Sour Soup', true, 'Peppery, tangy broth with shredded vegetables.'],
    ['Veg Clear Soup', true, 'Clear vegetable broth with julienned vegetables.'],
    ['Lemon Coriander Soup', true, 'Light broth brightened with lemon and fresh coriander.'],
    ['Cream of Mushroom Soup', true, 'Silky mushroom soup finished with cream.'],
    ['Cream of Tomato Soup', true, 'Classic thick tomato soup with fresh cream.'],
    ['Spinach Soup', true, 'Puréed spinach soup with garlic and a touch of cream.'],
    ['Chicken Manchow Soup', false, 'Spicy Indo-Chinese chicken soup with fried noodles.'],
    ['Chicken Hot and Sour Soup', false, 'Peppery, tangy broth with shredded chicken.'],
    ['Chicken Sweet Corn Soup', false, 'Corn and shredded chicken in a light broth.'],
    ['Chicken Clear Soup', false, 'Clear chicken broth with vegetables and pepper.'],
    ['Mutton Shorba', false, 'Slow-simmered spiced mutton broth.'],
  ]),
  ...section('salads', undefined, [
    ['Green Salad', true, 'Cucumber, tomato, onion and carrot with lemon.'],
    ['Kachumber Salad', true, 'Chopped cucumber, onion and tomato with chaat masala.'],
    ['Onion Salad', true, 'Sliced onion rings with lemon and green chilli.'],
    ['Russian Salad', true, 'Diced vegetables and pineapple in creamy mayonnaise.'],
    ['Caesar Salad', true, 'Romaine, croutons and parmesan in a classic Caesar dressing.'],
    ['Greek Salad', true, 'Cucumber, tomato, olives and feta in olive oil.'],
    ['Sprouts Salad', true, 'Moong sprouts tossed with onion, tomato and lemon.'],
    ['Corn Chaat', true, 'Steamed corn tossed with onion, chaat masala and lemon.'],
    ['Fruit Salad', true, 'Seasonal fresh fruit, chilled.'],
    ['Coleslaw', true, 'Shredded cabbage and carrot in a creamy dressing.'],
    ['Chicken Caesar Salad', false, 'Caesar salad topped with grilled chicken.'],
    ['Tandoori Chicken Salad', false, 'Greens tossed with tandoori chicken chunks.'],
  ]),
  ...section('main_course', undefined, [
    ['Paneer Butter Masala', true, 'Paneer in a rich, mildly sweet tomato-butter gravy.'],
    ['Shahi Paneer', true, 'Paneer in a creamy cashew and mild-spice Mughlai gravy.'],
    ['Kadai Paneer', true, 'Paneer with capsicum and onion in a coarse kadai masala.'],
    ['Palak Paneer', true, 'Paneer simmered in a smooth spiced spinach purée.'],
    ['Matar Paneer', true, 'Paneer and green peas in an onion-tomato gravy.'],
    ['Paneer Lababdar', true, 'Paneer in a silky tomato, cream and cashew gravy.'],
    ['Paneer Bhurji', true, 'Scrambled paneer with onion, tomato and spices.'],
    ['Paneer Do Pyaza', true, 'Paneer cooked with a double helping of onion.'],
    ['Chilli Paneer Gravy', true, 'Indo-Chinese paneer in a hot garlic-soy gravy.'],
    ['Malai Kofta', true, 'Paneer-and-potato dumplings in a creamy cashew gravy.'],
    ['Veg Kofta', true, 'Mixed-vegetable dumplings in a spiced onion-tomato gravy.'],
    ['Dal Makhani', true, 'Black lentils slow-cooked overnight with butter and cream.'],
    ['Dal Tadka', true, 'Yellow lentils tempered with cumin, garlic and ghee.'],
    ['Dal Fry', true, 'Lentils cooked with onion, tomato and spices.'],
    ['Chana Masala', true, 'Chickpeas in a tangy, robust onion-tomato masala.', ['chole']],
    ['Rajma Masala', true, 'Red kidney beans simmered in a homely Punjabi gravy.'],
    ['Aloo Gobi', true, 'Potato and cauliflower tossed with cumin and turmeric.'],
    ['Bhindi Masala', true, 'Okra sautéed with onion, tomato and spices.'],
    ['Baingan Bharta', true, 'Smoked, mashed aubergine cooked with onion and tomato.'],
    ['Mix Veg', true, 'Seasonal vegetables in a mild onion-tomato gravy.'],
    ['Veg Kolhapuri', true, 'Mixed vegetables in a fiery Kolhapuri masala.'],
    ['Veg Jalfrezi', true, 'Vegetables and paneer stir-fried in a tangy tomato sauce.'],
    ['Kaju Curry', true, 'Cashews in a rich, mildly sweet white gravy.'],
    ['Mushroom Masala', true, 'Button mushrooms in a spiced onion-tomato gravy.'],
    ['Soya Chaap Masala', true, 'Soya chaap simmered in a creamy tandoori-spiced gravy.'],
    ['Veg Manchurian Gravy', true, 'Vegetable dumplings in a garlic-soy Manchurian sauce.'],
    ['Sarson Ka Saag', true, 'Mustard greens slow-cooked with ghee — best with makki roti.'],
    ['Navratan Korma', true, 'Nine vegetables and nuts in a mild, creamy korma.'],
    ['Methi Malai Matar', true, 'Fenugreek and peas in a sweet, creamy gravy.'],
    ['Dum Aloo', true, 'Baby potatoes simmered in a spiced yogurt-tomato gravy.'],
    ['Butter Chicken', false, 'Tandoori chicken in a silky tomato-butter gravy.', ['murgh makhani']],
    ['Chicken Tikka Masala', false, 'Charred chicken tikka in a spiced tomato-cream gravy.'],
    ['Kadai Chicken', false, 'Chicken with capsicum and onion in a coarse kadai masala.'],
    ['Chicken Curry', false, 'Home-style chicken in an onion-tomato gravy.'],
    ['Chicken Handi', false, 'Chicken slow-cooked in a handi with cream and spices.'],
    ['Chicken Korma', false, 'Chicken in a mild cashew-and-yogurt Mughlai gravy.'],
    ['Chicken Chettinad', false, 'Fiery South-Indian chicken with pepper and coconut.'],
    ['Murgh Musallam', false, 'Whole chicken slow-cooked in a royal Awadhi gravy.'],
    ['Mutton Rogan Josh', false, 'Kashmiri mutton curry rich with chilli and fennel.'],
    ['Mutton Curry', false, 'Slow-cooked mutton on the bone in a spiced gravy.'],
    ['Mutton Handi', false, 'Mutton simmered in a handi with onion and whole spices.'],
    ['Mutton Keema', false, 'Minced mutton cooked with peas and spices.'],
    ['Fish Curry', false, 'Fish simmered in a tangy coconut or tomato gravy.'],
    ['Egg Curry', false, 'Boiled eggs in a spiced onion-tomato gravy.'],
    ['Prawn Masala', false, 'Prawns cooked in a coastal spiced masala.'],
  ]),
  ...section('breads', undefined, [
    ['Tandoori Roti', true, 'Whole-wheat flatbread baked in the tandoor.'],
    ['Butter Roti', true, 'Tandoori roti brushed with butter.'],
    ['Naan', true, 'Soft leavened flatbread from the tandoor.'],
    ['Butter Naan', true, 'Naan brushed generously with butter.'],
    ['Garlic Naan', true, 'Naan topped with garlic and coriander.'],
    ['Cheese Naan', true, 'Naan stuffed with melted cheese.'],
    ['Cheese Garlic Naan', true, 'Naan stuffed with cheese and topped with garlic.'],
    ['Stuffed Kulcha', true, 'Leavened bread stuffed with spiced potato or onion.'],
    ['Amritsari Kulcha', true, 'Crisp, flaky kulcha stuffed with potato and paneer.'],
    ['Lachha Paratha', true, 'Multi-layered flaky whole-wheat paratha.'],
    ['Pudina Paratha', true, 'Layered paratha flavoured with dried mint.'],
    ['Aloo Paratha', true, 'Whole-wheat bread stuffed with spiced potato.'],
    ['Paneer Paratha', true, 'Whole-wheat bread stuffed with spiced paneer.'],
    ['Missi Roti', true, 'Gram-flour and wheat roti with onion and spices.'],
    ['Rumali Roti', true, 'Paper-thin handkerchief bread.'],
    ['Bhatura', true, 'Fluffy deep-fried leavened bread — the partner to chole.'],
    ['Poori', true, 'Puffed deep-fried whole-wheat bread.'],
    ['Chapati', true, 'Everyday soft whole-wheat roti.', ['phulka']],
  ]),
  ...section('rice', undefined, [
    ['Steamed Rice', true, 'Plain steamed basmati rice.'],
    ['Jeera Rice', true, 'Basmati rice tempered with cumin and ghee.'],
    ['Veg Pulao', true, 'Basmati rice cooked with vegetables and whole spices.'],
    ['Veg Biryani', true, 'Layered basmati and vegetables, dum-cooked with saffron.'],
    ['Hyderabadi Veg Biryani', true, 'Spicy dum biryani with vegetables and fried onion.'],
    ['Paneer Biryani', true, 'Dum biryani layered with marinated paneer.'],
    ['Veg Fried Rice', true, 'Wok-tossed rice with vegetables and soy.'],
    ['Schezwan Fried Rice', true, 'Fried rice tossed in a fiery Schezwan sauce.'],
    ['Burnt Garlic Fried Rice', true, 'Fried rice with crisp burnt garlic.'],
    ['Curd Rice', true, 'Soft rice folded into curd with a mustard tempering.'],
    ['Lemon Rice', true, 'Rice tossed with lemon, peanuts and curry leaves.'],
    ['Kashmiri Pulao', true, 'Mildly sweet pulao with fruit and nuts.'],
    ['Dal Khichdi', true, 'Comforting rice and lentils cooked with ghee and spices.'],
    ['Chicken Biryani', false, 'Basmati layered with spiced chicken and dum-cooked.'],
    ['Hyderabadi Chicken Dum Biryani', false, 'Classic dum biryani with marinated chicken and saffron.'],
    ['Mutton Biryani', false, 'Slow dum-cooked biryani with mutton on the bone.'],
    ['Egg Biryani', false, 'Spiced biryani rice with boiled eggs.'],
    ['Chicken Fried Rice', false, 'Wok-tossed rice with shredded chicken and soy.'],
    ['Egg Fried Rice', false, 'Wok-tossed rice with scrambled egg and spring onion.'],
  ]),
  ...section('noodles', undefined, [
    ['Veg Hakka Noodles', true, 'Wok-tossed noodles with julienned vegetables and soy.'],
    ['Veg Chowmein', true, 'Street-style noodles with cabbage, carrot and capsicum.'],
    ['Schezwan Noodles', true, 'Noodles tossed in a fiery Schezwan chilli sauce.'],
    ['Chilli Garlic Noodles', true, 'Noodles wok-tossed with chilli flakes and garlic.'],
    ['Singapore Noodles', true, 'Thin rice noodles tossed with curry powder and vegetables.'],
    ['Pan Fried Noodles', true, 'Crisp-fried noodle cake under a vegetable gravy.'],
    ['Veg Chopsuey', true, 'Crisp noodles topped with sweet-and-sour vegetable gravy.'],
    ['Paneer Chilli Noodles', true, 'Hakka noodles tossed with chilli paneer.'],
    ['Chicken Hakka Noodles', false, 'Wok-tossed noodles with shredded chicken and soy.'],
    ['Chicken Chowmein', false, 'Street-style noodles with chicken and vegetables.'],
    ['Chicken Schezwan Noodles', false, 'Chicken noodles in a fiery Schezwan sauce.'],
    ['Egg Noodles', false, 'Noodles wok-tossed with scrambled egg and spring onion.'],
    ['Mixed Non-veg Noodles', false, 'Noodles with chicken, egg and prawn.'],
  ]),
  ...section('pasta', undefined, [
    ['White Sauce Pasta', true, 'Penne in a creamy béchamel with herbs.', ['alfredo']],
    ['Red Sauce Pasta', true, 'Penne in a tangy tomato-basil sauce.', ['arrabbiata']],
    ['Pink Sauce Pasta', true, 'Penne in a blend of tomato and cream sauce.'],
    ['Alfredo Pasta', true, 'Fettuccine in a rich parmesan cream sauce.'],
    ['Arrabbiata Pasta', true, 'Penne in a spicy tomato and garlic sauce.'],
    ['Pesto Pasta', true, 'Pasta tossed in basil, garlic and pine-nut pesto.'],
    ['Mac and Cheese', true, 'Macaroni baked in a molten cheddar sauce.'],
    ['Veg Lasagna', true, 'Layered pasta with vegetables, tomato and cheese, baked.'],
    ['Spaghetti Aglio e Olio', true, 'Spaghetti with garlic, olive oil and chilli flakes.'],
    ['Chicken Alfredo Pasta', false, 'Fettuccine and grilled chicken in parmesan cream.'],
    ['Spaghetti Bolognese', false, 'Spaghetti in a slow-cooked minced-meat tomato sauce.'],
    ['Chicken Lasagna', false, 'Layered pasta with minced chicken, tomato and cheese.'],
  ]),
  ...section('pizza', undefined, [
    ['Margherita Pizza', true, 'Tomato sauce and mozzarella — the classic.'],
    ['Farmhouse Pizza', true, 'Onion, capsicum, tomato and mushroom on mozzarella.'],
    ['Corn and Cheese Pizza', true, 'Sweet corn loaded onto a bed of mozzarella.'],
    ['Paneer Tikka Pizza', true, 'Tandoori paneer, onion and capsicum on tikka sauce.'],
    ['Veggie Delight Pizza', true, 'Onion, capsicum and sweet corn on a cheese base.'],
    ['Cheese Burst Pizza', true, 'Molten cheese sealed inside the crust.'],
    ['Double Cheese Pizza', true, 'Twice the mozzarella on a tomato base.'],
    ['Mexican Green Wave Pizza', true, 'Capsicum, jalapeño and onion with Mexican herbs.'],
    ['Tandoori Paneer Pizza', true, 'Paneer in tandoori masala with onion and capsicum.'],
    ['Garlic Bread', true, 'Baked bread with garlic butter and herbs.'],
    ['Cheesy Garlic Bread', true, 'Garlic bread loaded with molten mozzarella.'],
    ['Chicken Tikka Pizza', false, 'Tandoori chicken chunks with onion and capsicum.'],
    ['Chicken Pepperoni Pizza', false, 'Chicken pepperoni on mozzarella and tomato sauce.'],
    ['BBQ Chicken Pizza', false, 'Grilled chicken in barbecue sauce with onion.'],
    ['Chicken Supreme Pizza', false, 'Loaded with chicken, sausage, capsicum and onion.'],
  ]),
  ...section('burger', undefined, [
    ['Veg Burger', true, 'Crumb-fried vegetable patty with lettuce and mayo.'],
    ['Aloo Tikki Burger', true, 'Spiced potato tikki with tangy sauce in a soft bun.'],
    ['Cheese Burger', true, 'Veg patty with a slice of melting cheese.'],
    ['Paneer Burger', true, 'Grilled paneer patty with mint mayo.'],
    ['Crispy Veg Burger', true, 'Extra-crunchy crumb-fried vegetable patty.'],
    ['Mexican Burger', true, 'Spicy patty with jalapeño and salsa.'],
    ['Chicken Burger', false, 'Grilled chicken patty with lettuce and mayo.'],
    ['Crispy Chicken Burger', false, 'Crumb-fried chicken fillet in a soft bun.'],
    ['Chicken Cheese Burger', false, 'Chicken patty topped with melting cheese.'],
    ['Egg Burger', false, 'Fried egg, onion and sauce in a toasted bun.'],
  ]),
  ...section('sandwich', undefined, [
    ['Veg Sandwich', true, 'Cucumber, tomato and onion with mint chutney.'],
    ['Grilled Veg Sandwich', true, 'Grilled sandwich with vegetables and cheese.'],
    ['Bombay Masala Sandwich', true, 'Street-style sandwich with potato masala and chutney.'],
    ['Cheese Sandwich', true, 'Toasted sandwich loaded with cheese.'],
    ['Cheese Corn Sandwich', true, 'Creamy corn and cheese, grilled.'],
    ['Paneer Tikka Sandwich', true, 'Tandoori paneer filling, grilled.'],
    ['Club Sandwich', true, 'Triple-decker with vegetables, cheese and mayo.'],
    ['Chicken Sandwich', false, 'Shredded chicken in mayo with lettuce.'],
    ['Grilled Chicken Sandwich', false, 'Grilled chicken breast, cheese and herbs.'],
    ['Chicken Tikka Sandwich', false, 'Tandoori chicken filling, grilled.'],
    ['Egg Sandwich', false, 'Boiled egg and mayo on toasted bread.'],
  ]),
  ...section('desserts', undefined, [
    ['Gulab Jamun', true, 'Warm khoya dumplings soaked in cardamom sugar syrup.'],
    ['Rasmalai', true, 'Soft chhena discs in chilled saffron milk.'],
    ['Rasgulla', true, 'Spongy chhena balls in light sugar syrup.'],
    ['Gajar Ka Halwa', true, 'Carrots slow-cooked in milk, ghee and dry fruit.'],
    ['Moong Dal Halwa', true, 'Rich, ghee-laden lentil halwa with nuts.'],
    ['Jalebi', true, 'Crisp spirals soaked in saffron syrup.'],
    ['Kheer', true, 'Rice slow-simmered in milk with cardamom and nuts.'],
    ['Rabri', true, 'Thickened, layered sweet milk with pistachio.'],
    ['Kulfi', true, 'Dense frozen Indian milk ice with cardamom or pistachio.'],
    ['Falooda', true, 'Rose milk with vermicelli, basil seeds and ice cream.'],
    ['Shahi Tukda', true, 'Fried bread soaked in rabri and saffron syrup.'],
    ['Malpua', true, 'Fried sweet pancakes soaked in syrup, served with rabri.'],
    ['Ice Cream', true, 'A scoop of the day — ask for available flavours.'],
    ['Brownie with Ice Cream', true, 'Warm chocolate brownie with vanilla ice cream.'],
    ['Sizzling Brownie', true, 'Brownie and ice cream on a hot plate with chocolate sauce.'],
    ['Chocolate Lava Cake', true, 'Warm cake with a molten chocolate centre.'],
    ['Cheesecake', true, 'Baked cream-cheese dessert on a biscuit base.'],
    ['Tiramisu', true, 'Coffee-soaked sponge layered with mascarpone.'],
    ['Fruit Custard', true, 'Chilled custard with fresh seasonal fruit.'],
    ['Gulab Jamun with Ice Cream', true, 'Warm gulab jamun served with vanilla ice cream.'],
  ]),
  ...section('beverages', 'Tea', [
    ['Masala Chai', true, 'Strong tea brewed with milk, ginger and whole spices.', ['chai']],
    ['Adrak Chai', true, 'Milk tea brewed with fresh ginger.', ['ginger tea', 'chai']],
    ['Elaichi Chai', true, 'Milk tea brewed with green cardamom.', ['chai']],
    ['Kadak Chai', true, 'Extra-strong, boiled-down milk tea.', ['chai']],
    ['Green Tea', true, 'Light, unmilked green tea.'],
    ['Lemon Tea', true, 'Black tea with lemon and a hint of sugar.'],
    ['Black Tea', true, 'Plain brewed tea, no milk.'],
    ['Honey Lemon Tea', true, 'Black tea with honey and lemon.'],
    ['Tandoori Chai', true, 'Masala chai finished in a red-hot kulhad.', ['chai']],
    ['Kashmiri Kahwa', true, 'Saffron and almond green tea from Kashmir.'],
    ['Iced Tea', true, 'Chilled tea, lightly sweetened.'],
    ['Peach Iced Tea', true, 'Chilled tea with peach syrup.'],
  ]),
  ...section('beverages', 'Coffee', [
    ['Filter Coffee', true, 'South-Indian decoction coffee, frothed with hot milk.'],
    ['Hot Coffee', true, 'Classic milk coffee, served hot.'],
    ['Cold Coffee', true, 'Chilled blended coffee with milk and sugar.'],
    ['Cold Coffee with Ice Cream', true, 'Blended cold coffee topped with vanilla ice cream.'],
    ['Espresso', true, 'A concentrated single shot.'],
    ['Americano', true, 'Espresso lengthened with hot water.'],
    ['Cappuccino', true, 'Espresso with steamed milk and a thick foam cap.'],
    ['Latte', true, 'Espresso with plenty of steamed milk.'],
    ['Flat White', true, 'Double espresso with velvety micro-foam milk.'],
    ['Mocha', true, 'Espresso, chocolate and steamed milk.'],
    ['Caramel Macchiato', true, 'Vanilla milk, espresso and caramel drizzle.'],
    ['Affogato', true, 'A shot of hot espresso poured over vanilla ice cream.'],
    ['Frappe', true, 'Iced blended coffee topped with cream.'],
  ]),
  ...section('beverages', 'Shakes', [
    ['Mango Shake', true, 'Thick shake of fresh mango and chilled milk.'],
    ['Banana Shake', true, 'Creamy banana and milk shake.'],
    ['Chocolate Shake', true, 'Rich chocolate milkshake.'],
    ['Vanilla Shake', true, 'Classic vanilla ice-cream shake.'],
    ['Strawberry Shake', true, 'Strawberry and vanilla ice cream, blended.'],
    ['Oreo Shake', true, 'Cookies-and-cream shake topped with crumble.'],
    ['KitKat Shake', true, 'Chocolate wafer shake topped with cream.'],
    ['Butterscotch Shake', true, 'Butterscotch ice cream blended with milk and praline.'],
    ['Dry Fruit Shake', true, 'Milk blended with almonds, cashew and dates.'],
    ['Mango Lassi', true, 'Sweet yogurt drink blended with mango.'],
    ['Sweet Lassi', true, 'Thick sweetened yogurt drink.'],
    ['Salted Lassi', true, 'Savoury yogurt drink with roasted cumin.', ['namkeen lassi']],
    ['Chaas', true, 'Spiced buttermilk with cumin and coriander.', ['buttermilk']],
  ]),
  ...section('beverages', 'Fresh Juice', [
    ['Orange Juice', true, 'Freshly squeezed oranges.'],
    ['Mosambi Juice', true, 'Freshly squeezed sweet lime.'],
    ['Pineapple Juice', true, 'Fresh pineapple, blended and strained.'],
    ['Watermelon Juice', true, 'Chilled fresh watermelon juice.'],
    ['Pomegranate Juice', true, 'Freshly pressed pomegranate.', ['anar']],
    ['Mixed Fruit Juice', true, 'A blend of the day’s fresh fruit.'],
    ['Sugarcane Juice', true, 'Fresh-pressed cane juice with lemon and ginger.', ['ganne ka ras']],
    ['ABC Juice', true, 'Apple, beetroot and carrot pressed together.'],
    ['Nimbu Pani', true, 'Fresh lemonade, sweet or salted.', ['lemon water', 'shikanji']],
  ]),
  ...section('beverages', 'Soft Drinks', [
    ['Coke', true, 'Chilled bottle or can.', ['coca cola']],
    ['Pepsi', true, 'Chilled bottle or can.'],
    ['Sprite', true, 'Chilled lemon-lime soda.'],
    ['Fanta', true, 'Chilled orange soda.'],
    ['Thums Up', true, 'Chilled bottle or can.'],
    ['Limca', true, 'Chilled cloudy lemon soda.'],
    ['Maaza', true, 'Chilled mango drink.'],
    ['Mineral Water', true, 'Sealed bottled water.'],
    ['Soda', true, 'Chilled soda water with lemon on the side.'],
    ['Red Bull', true, 'Chilled energy drink.'],
  ]),
  ...section('beverages', 'Mocktails', [
    ['Virgin Mojito', true, 'Lime, mint and soda over crushed ice.'],
    ['Blue Lagoon', true, 'Blue curaçao syrup, lemon and sprite.'],
    ['Fruit Punch', true, 'A chilled blend of mixed fruit juices.'],
    ['Green Apple Mojito', true, 'Green apple, lime, mint and soda.'],
    ['Watermelon Mojito', true, 'Fresh watermelon with lime, mint and soda.'],
    ['Virgin Pina Colada', true, 'Pineapple and coconut cream, blended.'],
    ['Cranberry Cooler', true, 'Cranberry, lime and soda over ice.'],
    ['Jal Jeera', true, 'Chilled cumin and mint cooler.'],
    ['Aam Panna', true, 'Raw mango cooler with roasted cumin and mint.'],
  ]),
  ...section('beverages', 'Cocktails', [
    ['Mojito', true, 'White rum, lime, mint and soda.'],
    ['Margarita', true, 'Tequila, triple sec and lime with a salt rim.'],
    ['Long Island Iced Tea', true, 'Five spirits, lime and a splash of cola.'],
    ['Cosmopolitan', true, 'Vodka, triple sec, cranberry and lime.'],
    ['Bloody Mary', false, 'Vodka with spiced tomato juice and Worcestershire.'],
    ['Whiskey Sour', true, 'Whiskey, lemon and sugar, shaken.'],
    ['Old Fashioned', true, 'Whiskey stirred with sugar and bitters.'],
    ['Pina Colada', true, 'Rum, pineapple and coconut cream.'],
    ['Screwdriver', true, 'Vodka and fresh orange juice.'],
    ['Sangria', true, 'Wine with fruit and a splash of soda.'],
    ['Beer Tower', true, 'Three litres of chilled draught, poured at the table.'],
  ]),
];

/**
 * Photo for a dish. Real, licensed photography lands on `Dish.photo` when the
 * backend arrives; until then this is a keyword-matched placeholder so the
 * owner (and the menu screen) still sees a picture rather than a grey box.
 */
export function dishImage(dish: Dish): string {
  if (dish.photo) return dish.photo;
  const keywords = encodeURIComponent(`${dish.name},indian food`);
  return `https://loremflickr.com/320/240/${keywords}`;
}

/**
 * Community dishes — names owners have listed that the code catalog didn't
 * know. They're loaded from approved `CatalogEntry` rows at app start (see
 * domain/catalogEntries.ts) and fold into `searchDishes` so the next owner
 * gets them as ready suggestions. They carry only a name (no curated
 * description / veg dot / photo), so tapping one just fills the name.
 */
let communityDishes: Dish[] = [];

/** Replace the community-dish overlay merged into `searchDishes`. */
export function setCommunityDishes(dishes: Dish[]): void {
  communityDishes = dishes;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Type-to-search over the catalog — the ONLY way dishes surface, because the
 * catalog is far too long to browse. "pane" → Paneer Butter Masala, Matar
 * Paneer, Shahi Paneer…
 *
 * Ranking, best first: name starts with the query → a word in the name starts
 * with it → it appears anywhere in the name → a search alias matches. Dishes in
 * the section the owner has open sort above the rest of the catalog, so
 * "chicken" inside Soups leads with the soups, but a Chicken Biryani is still
 * reachable if they picked the wrong section.
 */
export function searchDishes(
  query: string,
  opts: { sectionId?: string; subcategory?: string; limit?: number } = {},
): Dish[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const limit = opts.limit ?? 8;

  const scored: { dish: Dish; score: number }[] = [];
  const all = communityDishes.length ? [...DISH_CATALOG, ...communityDishes] : DISH_CATALOG;
  for (const dish of all) {
    const name = norm(dish.name);
    let score: number;
    if (name.startsWith(q)) score = 0;
    else if (name.split(' ').some((w) => w.startsWith(q))) score = 1;
    else if (name.includes(q)) score = 2;
    else if (dish.aka?.some((a) => norm(a).includes(q))) score = 3;
    else continue;

    // Same section as the one they're filling in ranks above everything else.
    if (opts.sectionId && dish.sectionId === opts.sectionId) {
      score -= opts.subcategory && dish.subcategory === opts.subcategory ? 12 : 10;
    }
    scored.push({ dish, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.dish.name.length - b.dish.name.length)
    .slice(0, limit)
    .map((s) => s.dish);
}

/** The section a catalog dish belongs to, for labelling a cross-section hit. */
export function dishSection(dish: Dish): FoodMenuSection | undefined {
  return getFoodSection(dish.sectionId);
}

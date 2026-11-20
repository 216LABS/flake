import { describe, expect, it } from 'vitest';
import { cityOf, parsePlace, sameStreet, streetFits, streetKey, tidyAddress, titleCase } from '../src/address';
import { serviceArea } from '../src/trigger';

/** Issues 206 and 210: a lot's address, city and name read the same however the address was typed or matched. */
describe('addresses', () => {
  it('title-cases shouting or all-lower text and keeps mixed case', () => {
    expect(titleCase('LAKEWOOD')).toBe('Lakewood');
    expect(titleCase('fairview park')).toBe('Fairview Park');
    expect(titleCase('14600 DETROIT RD NW')).toBe('14600 Detroit Rd NW');
    expect(titleCase("O'FALLON")).toBe("O'Fallon");
    expect(titleCase('1ST AVE')).toBe('1st Ave');
    expect(titleCase("JOE'S PLAZA")).toBe("Joe's Plaza");
    expect(titleCase('McKees Rocks')).toBe('McKees Rocks');
    expect(titleCase('WINSTON-SALEM')).toBe('Winston-Salem');
  });

  it('compares streets however the suffix is written, and half-typed streets fit', () => {
    expect(streetKey('14701 Detroit Ave., Lakewood')).toBe('14701 detroit avenue');
    expect(sameStreet('14701 Detroit Ave', '14701 DETROIT AVENUE, LAKEWOOD, OH')).toBe(true);
    expect(sameStreet('14701 Detroit Ave', '14701 DETROIT RD')).toBe(false);
    expect(streetFits('14600 Detr', '14600 Detroit Avenue')).toBe(true);
    expect(streetFits('14600 Detroit Ave', '14600 DETROIT AVENUE')).toBe(true);
    expect(streetFits('14600 Detroit Ave', '14600 DETROIT RD')).toBe(false);
    expect(streetFits('1 Cascade Plaza', '1 CASCADE ST')).toBe(false);
    expect(streetFits('1 Cascade Plaza Akron', '1 Cascade Plaza')).toBe(false);
    expect(streetFits('', '1 Main St')).toBe(true);
  });

  it('reads Census, Photon and typed labels', () => {
    expect(parsePlace('14600 DETROIT RD, LAKEWOOD, OH, 44107')).toEqual({ street: '14600 DETROIT RD', city: 'LAKEWOOD', state: 'OH', zip: '44107' });
    expect(parsePlace('14600 Detroit Avenue, Lakewood, OH 44107')).toEqual({ street: '14600 Detroit Avenue', city: 'Lakewood', state: 'OH', zip: '44107' });
    expect(parsePlace('5000 Forbes Ave, Pittsburgh, Pennsylvania 15213, United States')).toEqual({ street: '5000 Forbes Ave', city: 'Pittsburgh', state: 'PA', zip: '15213' });
    expect(parsePlace('350 5th Ave, New York, NY 10118')).toMatchObject({ city: 'New York', state: 'NY' });
    expect(parsePlace('100 Main Ave, De Pere, WI 54115')).toMatchObject({ city: 'De Pere', state: 'WI' });
    expect(parsePlace('3250 W Market St, Fairlawn OH 44333-1234')).toMatchObject({ city: 'Fairlawn', state: 'OH', zip: '44333-1234' });
    expect(parsePlace('Main St (street, no house number), Medina, Ohio')).toMatchObject({ street: 'Main St', city: 'Medina', state: 'OH' });
    expect(parsePlace('just words')).toEqual({ street: 'just words', city: '', state: '', zip: '' });
    expect(parsePlace('')).toEqual({ street: '', city: '', state: '', zip: '' });
    // A lower-case "oh" at the end of a longer part is a word, not Ohio; the first state and ZIP win.
    expect(parsePlace('9 Elm St, Lake oh, oh, 44107, KY 40202')).toEqual({ street: '9 Elm St', city: 'Lake oh', state: 'OH', zip: '44107' });
  });

  it('finds the city in saved addresses, with or without commas', () => {
    expect(cityOf('14600 DETROIT RD, LAKEWOOD, OH, 44107')).toBe('Lakewood');
    expect(cityOf('3250 W Market St, Fairlawn, OH 44333')).toBe('Fairlawn');
    // Imported before this fix: typed with no commas.
    expect(cityOf('12700 Lake Ave Lakewood OH')).toBe('Lakewood');
    expect(cityOf('3211 Westgate Mall Fairview Park OH 44126')).toBe('Fairview Park');
    expect(cityOf('500 Main St NW Canton OH')).toBe('Canton');
    expect(cityOf('500 Court St Main St Elyria OH')).toBe('Elyria');
    // Not sure, so no guess.
    expect(cityOf('no commas here')).toBe('');
    expect(cityOf('12700 Lake Lakewood OH')).toBe('');
    expect(cityOf('12700 Lake Ave OH')).toBe('');
    expect(cityOf('12700 Lake Ave NW OH')).toBe('');
    expect(cityOf('')).toBe('');
  });

  it('service areas are the same city however it was typed', () => {
    const areas = ['12700 Lake Ave Lakewood OH', '14600 DETROIT RD, LAKEWOOD, OH, 44107', '1474 Belle Ave, Lakewood, OH 44107'].map((a) => serviceArea(a));
    expect(new Set(areas)).toEqual(new Set(['Lakewood']));
  });

  it('tidies an import or a pick into one form', () => {
    // A typed street the geocoder matched keeps the matched spelling, in normal case.
    expect(tidyAddress('12700 Lake Ave Lakewood OH', '12700 LAKE AVE, LAKEWOOD, OH, 44107')).toBe('12700 Lake Ave, Lakewood, OH 44107');
    expect(tidyAddress('3211 Westgate Mall Fairview Park OH', '3211 WESTGATE MALL, FAIRVIEW PARK, OH, 44126')).toBe('3211 Westgate Mall, Fairview Park, OH 44126');
    expect(tidyAddress('3250 W Market St, Fairlawn, OH 44333', '3250 W MARKET ST, FAIRLAWN, OH, 44333')).toBe('3250 W Market St, Fairlawn, OH 44333');
    // A different street from the geocoder: the office's street, the geocoder's city (issue 210).
    expect(tidyAddress('14600 Detroit Ave, Lakewood, OH', '14600 DETROIT RD, LAKEWOOD, OH, 44107')).toBe('14600 Detroit Ave, Lakewood, OH 44107');
    expect(tidyAddress('1 Cascade Plaza Akron OH', '1 CASCADE ST, AKRON, OH, 44304')).toBe('1 Cascade Plaza, Akron, OH 44304');
    // Only the street typed, in full, and the match is another street.
    expect(tidyAddress('1470 Detroit Rd', '1470 Detroit Ave, Lakewood, OH')).toBe('1470 Detroit Rd, Lakewood, OH');
    expect(tidyAddress('Rd', '1470 Detroit Ave, Lakewood, OH')).toBe('1470 Detroit Ave, Lakewood, OH');
    // Half typed, then a suggestion picked: the suggestion's street.
    expect(tidyAddress('14600 Detr', '14600 Detroit Avenue, Lakewood, OH 44107')).toBe('14600 Detroit Avenue, Lakewood, OH 44107');
    // Typed city differs from the match's: can't split it off, so the match's street.
    expect(tidyAddress('9 Elm St Cleveland OH', '9 ELM ST, LAKEWOOD, OH, 44107')).toBe('9 Elm St, Lakewood, OH 44107');
    // Only a city, no state or ZIP; or no city in the match at all.
    expect(tidyAddress('9 Elm St', '9 Elm St, Lakewood')).toBe('9 Elm St, Lakewood');
    expect(tidyAddress('  9 Elm St Lakewood  ', '9 Elm St (mock geocode)')).toBe('9 Elm St Lakewood');
    expect(tidyAddress('Lakewood', '9 ELM ST, LAKEWOOD, OH')).toBe('9 Elm St, Lakewood, OH');
    expect(tidyAddress('9 Elm St Lakewood OH 44107', '9 ELM ST, LAKEWOOD, OH, 44107')).toBe('9 Elm St, Lakewood, OH 44107');
  });
});

import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('ava_benchmark', Path(__file__).parents[2] / 'scripts/prepare-ava-pair-benchmark.py')
ava = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ava)


class AnnotationCategories(unittest.TestCase):
    def test_positive_requires_both(self):
        self.assertEqual(ava.category(['a', 'b', 'other'], 'a', 'b'), 'positive')

    def test_solo_requires_only_target(self):
        self.assertEqual(ava.category(['a'], 'a', 'b'), 'solo-a')
        self.assertEqual(ava.category(['b'], 'a', 'b'), 'solo-b')

    def test_group_does_not_double_count_solo(self):
        self.assertEqual(ava.category(['a', 'other'], 'a', 'b'), 'groups')
        self.assertEqual(ava.category(['b', 'other'], 'a', 'b'), 'groups')

    def test_empty_is_not_negative(self):
        self.assertIsNone(ava.category([], 'a', 'b'))
        self.assertEqual(ava.category(['other'], 'a', 'b'), 'negative')

    def test_targets_must_differ(self):
        with self.assertRaises(ValueError):
            ava.category(['a'], 'a', 'a')

    def test_spacing_sorted_unique(self):
        self.assertEqual(ava.spaced([2000, 0, 500, 1000, 1000, 1999], 1000), [0, 1000, 2000])

    def test_temporal_gap(self):
        ava.check_temporal_integrity([(0, 'ref'), (500, 'ref2')], [(2500, 'query')], 2000)
        with self.assertRaises(ValueError):
            ava.check_temporal_integrity([(500, 'ref')], [(2499, 'query')], 2000)

    def test_hash_leakage(self):
        with self.assertRaises(ValueError):
            ava.check_temporal_integrity([(0, 'same')], [(3000, 'same')], 2000)

    def test_duplicate_query(self):
        with self.assertRaises(ValueError):
            ava.check_temporal_integrity([(0, 'ref')], [(3000, 'query'), (4000, 'query')], 2000)

    def test_metadata_selection_is_temporally_separated(self):
        box = [0.1, 0.1, 0.3, 0.3]
        frames = {t: {'a': box, 'b': box} for t in range(0, 10001, 40)}
        frames.update({t: {'a': box} for t in range(-2000, 0, 40)})
        frames.update({t: {'b': box} for t in range(10040, 12041, 40)})
        pair = ava.candidates('video', frames)[0]
        self.assertGreaterEqual(len(pair['references']), 3)
        self.assertGreaterEqual(min(pair['queries']) - max(pair['references']), 2000)
        self.assertTrue(all(b - a >= 1000 for a, b in zip(pair['queries'], pair['queries'][1:])))


if __name__ == '__main__':
    unittest.main()

from allocate_new_foliage import allocate_new_foliage
import numpy as np
import unittest, types
pytest = types.SimpleNamespace(raises=unittest.TestCase().assertRaises)

def _case():
    return (
        np.array([[0., 0., 0.], [1., 0., 0.], [3., 1., 0.]]),
        np.array([11, 22, 33]),
        np.array([[0., 0., 0.], [2., 0., 0.]]),
        np.array([[1., .5, 1.], [.7, 1.2, .8]]),
        np.array([1., .6, 1.4]),
        np.array([1, 0, 2]),
    )

def test_incremental_equals_one_shot():
    a = _case()
    c10, x10 = allocate_new_foliage(*a, 10, 7)
    c20, x20 = allocate_new_foliage(*a, 20, 7)
    ci, xi = allocate_new_foliage(a[0], a[1], a[2], a[3], a[4], c10, 20, 7)
    assert np.array_equal(c20, ci)
    assert x20[:len(x10)] == x10 and x20[len(x10):] == xi

def test_shuffled_input_order_is_equivalent():
    a = _case()
    perm = np.array([2, 0, 1])
    c, x = allocate_new_foliage(*a, 20, 7)
    cs, xs = allocate_new_foliage(a[0][perm], a[1][perm], a[2], a[3],
                                  a[4][perm], a[5][perm], 20, 7)
    assert dict(zip(a[1], c)) == dict(zip(a[1][perm], cs))
    assert x == xs

def test_existing_counts_persist():
    a = _case()
    before = a[5].copy()
    c, added = allocate_new_foliage(*a, 7, 7)
    assert np.all(c >= before) and len(added) == 4
    assert np.array_equal(a[5], before)

def test_rejects_invalid_target_and_nonfinite_input():
    a = _case()
    with pytest.raises(ValueError):
        allocate_new_foliage(*a, 2, 7)
    bad = list(a)
    bad[0] = bad[0].copy()
    bad[0][0, 0] = np.nan
    with pytest.raises(ValueError):
        allocate_new_foliage(*bad, 7, 7)

def test_outside_support_keeps_prior():
    c, _ = allocate_new_foliage(
        np.array([[100., 0., 0.]]), np.array([9]),
        np.array([[0., 0., 0.]]), np.array([[.1, .1, .1]]),
        np.array([1.]), np.array([0]), 1, 3)
    assert c.tolist() == [1]


def test_thirty_seeded_scenarios():
    for seed in range(30):
        rng = np.random.default_rng(seed)
        n = 40
        points = rng.normal(size=(n, 3))
        ids = np.arange(200, 200+n)
        centers = rng.normal(size=(7, 3))
        radii = rng.uniform(.1, 2, (7, 3))
        weights = rng.uniform(0, 2, n)
        old = rng.integers(0, 5, n)
        mid, end = int(old.sum())+100, int(old.sum())+400
        args = (points, ids, centers, radii, weights, old)
        first, first_pairs = allocate_new_foliage(*args, mid, seed)
        incremental, second_pairs = allocate_new_foliage(points, ids, centers, radii, weights, first, end, seed)
        direct, direct_pairs = allocate_new_foliage(*args, end, seed)
        assert np.array_equal(incremental, direct)
        assert first_pairs + second_pairs == direct_pairs
        permutation = rng.permutation(n)
        shuffled, shuffled_pairs = allocate_new_foliage(points[permutation], ids[permutation], centers, radii, weights[permutation], old[permutation], end, seed)
        assert dict(zip(ids, direct)) == dict(zip(ids[permutation], shuffled))
        assert direct_pairs == shuffled_pairs
        assert np.all(direct >= old)

if __name__ == "__main__":
    cases = [(n,f) for n,f in list(globals().items()) if n.startswith("test_")]
    for n,f in cases:
        f()
        print("PASS", n)
    print(f"{len(cases)} test functions passed (5 supplied fixtures and 30 seeded scenarios); unittest assertRaises adapter, no pytest dependency")

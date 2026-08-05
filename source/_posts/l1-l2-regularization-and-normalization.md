---
title: L1/L2 正则化、Frobenius 范数与 RegMean
date: 2026-08-05 23:08:00
updated: 2026-08-05 23:08:00
description: 整理 L1/L2 正则化、Frobenius 范数与 RegMean 正则项的基本概念和联系。
mathjax: true
categories:
  - 机器学习
tags:
  - L1 正则化
  - L2 正则化
  - 线性代数
  - RegMean
---

本文整理 L1、L2 正则化的基本概念，并补充 Frobenius 范数与矩阵迹的关系，以及 RegMean 正则项和传统 L2 正则化之间的区别。

<!-- more -->



## L1/L2 正则化

### 不同的正则化

$$\begin{array}{l}
&\text{Def. 1: if } x=[x\_1,\ldots,x\_n]^\top,\\\\
&\text{then } ||x||\_p=\left(\sum\_{i=1}^{n}|x\_i|^p\right)^{\frac{1}{p}}.
\end{array}$$

$$\begin{array}{l}
&\text{Exp. 1: } L\_0\text{-norm is the number of non-zero elements},\\\\
&L\_1\text{-norm}=\sum\_{i=1}^n|x\_i|,\\\\
&L\_2\text{-norm}=\sqrt{\sum\_{i=1}^n|x\_i|^2}.
\end{array}$$

- 一般来说，supervised learning的objective function可以看作是$\text{Loss}(y\_i,f(x\_i,\theta))+\text{norm regularizer/penalty term}$

- 第一项是衡量模型对第`i`个样本的预测值和真实标签之间的误差，也就是要求我们的模型尽量的拟合我们的训练数据。但我们不仅要保证训练误差最小，我们更希望我们的模型测试误差小，所以我们需要加上第二项，也就是对参数w的规则化函数$\Omega(w)$去约束我们的模型尽量的简单。

- $\Omega(w)$有很多种选择，一般是模型复杂度的单调递增函数，模型越复杂，规则化值就越大。比如，规则化项可以是模型参数向量的范数。

#### L1-Norm

**L1范数和L0范数可以实现稀疏，L1因具有比L0更好的优化求解特性而被广泛应用。**

- L1范数又称稀疏规则算子（Lasso Regularizer）。任何的规则化算子，如果他在$W\_i=0$的地方不可微，并且可以分解为一个“求和”的形式，那么这个规则化算子就可以实现稀疏。
- **feature selection**：将一些参数置0相当于在去掉没用的特征。
- **interpretability**：可以解释目标和最后学习到的非0特征的相关性。

##### 为什么L1范数可以实现稀疏化？

$\text{Exp. 2}$
$$
\text{for 2-dimension/2 parameters case } w\_1 ,w\_2\text{, L}\_1\text{-norm is }\\\\ ||w||\_1=|w\_1|+|w\_2|\\\\
\text{L}\_1\text{-Ball is defined as }|w\_1|+|w\_2|\leq C
$$

- 目标loss函数通常是一圈圈椭圆等高线（下图以抛物面为例，等高线是一圈圈的同心圆），优化过程相当于椭圆等高线不断扩张直到第一次触碰到L1-Ball
- 由于 L1-ball 的几何形状是一个带有尖锐顶点的菱形，并且这些顶点突出在坐标轴上。
- 当外围的椭圆等高线向内收缩并与这个菱形相切时，由于菱形的“角”是最往外凸出的部分，椭圆有极高的概率直接与这些**角**相交，而不是与平直的边相切。
- 一旦相切点位于“角”上（例如交点在 $(C, 0)$），此时 $w\_2$ 就严格等于 0。这就产生了稀疏解。

<img src="/images/regularization/l1-ball-1.png" alt="L1 Ball 与损失函数等高线" style="zoom: 33%;" />

<img src="/images/regularization/l1-ball-2.png" alt="L1 正则化产生稀疏解的几何解释" style="zoom:33%;" />

#### L2-Norm

又称岭回归（Ridge Regression）或者Weight Decay。主要用于改善**过拟合**。

直观上看，L2-Norm是让每个参数都尽量小，防止某个feature对最终结果影响过大。

##### 从病态矩阵角度看

$\text{Def. 2}$
$$
\text{for a matrix }A\in \mathbb{R}^{m\times n},\text{use SVD then we can get }\\\\
A=U\Sigma V^\top \\\\
\Sigma \text{ represents scaling in features where singular value is non-zero.}\\\\
\text{The condition number of A is define as }\frac{SV\_{\max}}{SV\_{\min}}  
$$
如果条件数很大（**病态矩阵**），那么对于输入x的微小变化，输出Ax在奇异值大的方向的scaling就会远大于奇异值小的方向的scaling。
$$
\text{Suppose we have N samples, each having D features.(To include bias b, set D+1 features.)} \\\\
\text{for objective function }l=\frac{1}{N}||XW-Y||^2,\text{where }X \in \mathbb{R}^{N\times (D+1)},Y\in \mathbb{R}^{N\times 1},W\in \mathbb{R}^{(D+1)\times 1} \\\\
$$
可以得到闭式解$\hat{W} = (X^T X)^{-1} X^T y$，加了L2正则项之后，我们的解析解变为$\hat{W} = (X^T X + \lambda I)^{-1} X^T y$。也就是给$X X^\top$中的所有奇异值加上一个 $\lambda$，可以确保奇异值不会太小，而导致再求逆后，奇异值变的极大。这样有效的解决了病态矩阵的问题。过拟合的实质可以看作由于病态矩阵的存在，如果y有一点波动，整个模型需要大幅度调整。解决了病态矩阵问题，就解决了过拟合。

------

## Frobenius 范数与矩阵迹

在数学和线性代数中，Frobenius 范数的平方与矩阵内积的迹等价是一个非常经典的恒等式。论文的附录 A.4 中也明确指出了这一点：“我们通过其迹恒等式来计算 Frobenius 范数，即 $||\Delta W\_t||\_F^2 = Tr(\Delta W\_t^\top \Delta W\_t)$” 。



下面给出这一等价关系的推导，并通过一个简单例子验证。

### 1. 数学推导

假设有一个 $m \times n$ 的实数矩阵 $A$（在论文中对应任务向量 $\Delta W\_t$），其元素记为 $a\_{ij}$（表示第 $i$ 行、第 $j$ 列的元素）。

**左边：Frobenius 范数平方的定义**

矩阵 $A$ 的 Frobenius 范数定义为矩阵中所有元素平方和的平方根。因此，其**平方**就是所有元素的平方和：

$$||A||\_F^2 = \sum\_{i=1}^m \sum\_{j=1}^n a\_{ij}^2$$

**右边：矩阵内积的迹**

首先计算矩阵内积 $A^\top A$。

- $A^\top$ 是 $A$ 的转置矩阵，维度为 $n \times m$，其第 $j$ 行第 $i$ 列的元素为 $a\_{ij}$。

- 根据矩阵乘法法则，设 $B = A^\top A$，$B$ 是一个 $n \times n$ 的方阵。$B$ 的第 $j$ 行第 $j$ 列的对角线元素 $b\_{jj}$，等于 $A^\top$ 的第 $j$ 行与 $A$ 的第 $j$ 列的点积：

  $$b\_{jj} = \sum\_{i=1}^m (A^\top)\_{ji} \cdot A\_{ij} = \sum\_{i=1}^m a\_{ij} \cdot a\_{ij} = \sum\_{i=1}^m a\_{ij}^2$$

  矩阵的迹（Trace）定义为方阵主对角线元素之和。因此，$A^\top A$ 的迹为：

  $$Tr(A^\top A) = \sum\_{j=1}^n b\_{jj} = \sum\_{j=1}^n \left( \sum\_{i=1}^m a\_{ij}^2 \right) = \sum\_{i=1}^m \sum\_{j=1}^n a\_{ij}^2$$

**结论：**

可以看出，左右两边的展开式完全相同，即：

$$||A||\_F^2 = Tr(A^\top A)$$

------

### 2. 简单例子验证

假设我们有一个 $2 \times 2$ 的简单矩阵 $A$：

$$A = \left[\begin{array}{cc} 1 & 2 \\\\ 3 & 4 \end{array}\right]$$

**计算 1：按 Frobenius 范数平方定义计算**

将矩阵中所有元素各自平方后求和：

$$||A||\_F^2 = 1^2 + 2^2 + 3^2 + 4^2 = 1 + 4 + 9 + 16 = 30$$

**计算 2：按矩阵内积的迹计算**

第一步，写出 $A$ 的转置矩阵 $A^\top$：

$$A^\top = \left[\begin{array}{cc} 1 & 3 \\\\ 2 & 4 \end{array}\right]$$

第二步，计算矩阵乘积 $A^\top A$：

$$A^\top A = \left[\begin{array}{cc} 1 & 3 \\\\ 2 & 4 \end{array}\right] \left[\begin{array}{cc} 1 & 2 \\\\ 3 & 4 \end{array}\right] = \left[\begin{array}{cc} (1\times1 + 3\times3) & (1\times2 + 3\times4) \\\\ (2\times1 + 4\times3) & (2\times2 + 4\times4) \end{array}\right] = \left[\begin{array}{cc} 10 & 14 \\\\ 14 & 20 \end{array}\right]$$

第三步，计算所得矩阵的主对角线元素之和（即迹）：

$$Tr(A^\top A) = 10 + 20 = 30$$

**验证结果：** 通过两种方法计算得出的结果都是 **30**，完美验证了 $||\Delta W\_t||\_F^2 \equiv Tr(\Delta W\_t^\top \Delta W\_t)$ 这一数学恒等式 。在代码实现中，计算矩阵对角线之和通常比手动遍历所有元素平方和更容易调用现成的线性代数库函数进行并行加速。

------

## RegMean 与 L2 正则化

RegMean 损失函数中的正则化项本质上是对权重偏离度的惩罚，但它与传统的 $L2$ 正则化在**惩罚力度的分配机制**上有根本区别。

一句话概括：标准 $L2$ 正则化对所有权重的偏离进行**无差别的均匀惩罚**（各向同性），而 RegMean 的正则化项是一种**数据驱动的、自适应的惩罚**（各向异性）。

可以从数学公式和直觉两个角度比较二者。

### 一、 数学公式对比

如果我们要用传统的 $L2$ 正则化来约束融合权重 $W\_{M}^{(l)}$ 靠近候选模型权重 $W\_{i}^{(l)}$，其迹形式（Trace form）的数学表达式通常是这样的：

$$\mathcal{L}\_{L2} = \lambda \sum\_{i=1}^{K} tr[(W\_{M}^{(l)} - W\_{i}^{(l)})^{\top}I(W\_{M}^{(l)} - W\_{i}^{(l)})]$$

其中，$I$ 是单位矩阵，$\lambda$ 是统一的标量惩罚系数。

而 **RegMean 的正则化项**为：



$$\mathcal{L}\_{Reg} = \sum\_{i=1}^{K} tr[(W\_{M}^{(l)} - W\_{i}^{(l)})^{\top}\Lambda\_{i}^{(l)}(W\_{M}^{(l)} - W\_{i}^{(l)})]$$



决定两者差异的核心在于中间的权重矩阵 $\Lambda\_{i}^{(l)}$ 。

在 RegMean 中，$\Lambda\_{i}^{(l)}$ 被定义为：



$$\Lambda\_{i}^{(l)} = \frac{1-\alpha}{\alpha} diag((X\_{i}^{(l)})^{\top}X\_{i}^{(l)}) \ge 0$$



### 二、 核心区别详解

#### 1. 惩罚项的“各向同性” vs “各向异性”

- **$L2$ 正则化**：因为使用的是单位矩阵 $I$（或统一常数），所以它对权重矩阵中**每一个元素的改变都施加完全相同的惩罚**。

- 

  **RegMean 正则化**：使用的是对角矩阵 $\Lambda\_{i}^{(l)}$，这意味着它对 $W\_{M}^{(l)}$ 中不同行的权重施加了**不同量级的惩罚** 。

#### 2. 数据依赖性 (Data-Dependence)

- **$L2$ 正则化**：惩罚力度 $\lambda$ 是一个固定的超参数，与输入数据完全无关。

- 

  **RegMean 正则化**：惩罚矩阵 $\Lambda\_{i}^{(l)}$ 直接由该层输入特征的内积矩阵 $(X\_{i}^{(l)})^{\top}X\_{i}^{(l)}$ 决定 。矩阵的对角线元素 $(X\_{i}^{(l)})^{\top}X\_{i}^{(l)}$ 代表了各个输入特征维度在候选模型 $f\_i$ 的数据集上的**激活强度（或方差）** 。

#### 3. 物理直觉与目的

- **特征重要性感知的约束**：如果某个维度的特征在候选模型 $f\_i$ 中经常被激活且数值很大（对应对角线元素值很大），RegMean 会认为**与该特征相乘的权重非常重要**，因此会对其施加强烈的正则化约束，迫使融合后的权重在这个方向上极度贴合原模型 $W\_{i}^{(l)}$ 。

- 反之，如果某个特征维度处于休眠状态（数值趋近于 0），则允许融合权重在该方向上有更大的自由度。

- **增强稳定性**：论文明确指出，RegMean 通过减小内积矩阵的非对角线元素（即提取对角线部分 $diag(\cdot)$）来增强融合过程中的稳定性 。

### 总结

可以将 $L2$ 正则化看作是“一刀切”的橡皮筋，无论哪个方向拉伸，回弹力都一样；而 RegMean 的正则化项是一张“智能弹簧网”，它的各个节点的弹力大小是由**候选模型的训练数据特征**决定的，重要特征对应的弹力极强，次要特征对应的弹力较弱 。

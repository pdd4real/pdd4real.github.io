---
title: 从 GCN 到 GAT：公式、直觉与代码笔记
date: 2026-08-05 23:08:00
updated: 2026-08-05 23:08:00
description: 以公式、直觉、代码和模型对比四个角度整理 GCN 与 GAT 的核心机制。
mathjax: true
categories:
  - 图神经网络
tags:
  - GCN
  - GAT
  - GNN
  - PyTorch
---

# 从 GCN 到 GAT：公式、直觉与代码笔记

图神经网络（GNN）需要把规则网格数据上的深度学习方法迁移到不规则的拓扑数据上。图卷积网络（GCN）是这一领域的基础，也是理解图学习中消息传递思想的一个合适起点。

<!-- more -->

下面从公式、直觉、代码和模型对比四个方面整理 Kipf 和 Welling 在 2017 年提出的经典 GCN 模型。

------

### 1. 数学原理 / 公式

GCN 的核心在于如何在一层网络中，基于图的拓扑结构更新节点的特征。其前向传播的逐层更新公式可以浓缩为以下这个优雅的等式：

$$H^{(l+1)} = \sigma(\tilde{D}^{-\frac{1}{2}} \tilde{A} \tilde{D}^{-\frac{1}{2}} H^{(l)} W^{(l)})$$

**公式中的变量定义：**

- $H^{(l)}$：第 $l$ 层的节点特征矩阵，维度为 $N \times C$（$N$ 是节点数，$C$ 是特征维度）。输入层的 $H^{(0)}$ 即为原始节点特征矩阵 $X$。
- $\tilde{A}$：带有自环的邻接矩阵，即 $\tilde{A} = A + I_N$（$A$ 是图的邻接矩阵，$I_N$ 是单位矩阵）。
- $\tilde{D}$：$\tilde{A}$ 的度矩阵（对角矩阵），其对角线元素为 $\tilde{D}_{ii} = \sum_j \tilde{A}_{ij}$。
- $W^{(l)}$：第 $l$ 层的可学习权重矩阵，负责特征维度的变换。
- $\sigma(\cdot)$：非线性激活函数（例如 ReLU）。

------

### 2. 公式所代表的几何含义 / 数学直觉

这个看似复杂的公式，其实可以用**“消息传递与特征平滑”**的直觉来拆解。我们可以将核心部分 $\tilde{D}^{-\frac{1}{2}} \tilde{A} \tilde{D}^{-\frac{1}{2}} H^{(l)} W^{(l)}$ 分解为三个动作：

- **特征变换（$H^{(l)} W^{(l)}$）：**
  - **直觉：** 这与普通的全连接层无异。它将节点的特征向量从当前空间投影到一个新的特征空间。此时，每个节点仅仅是“自己思考”，还没有和邻居发生联系。
- **加上自环的邻居聚合（$\tilde{A} \times \text{特征}$）：**
  - **直觉：** 如果我们将 $\tilde{A}$ 乘以上一步的结果，几何意义是**“收集并相加”**邻居的特征。为什么邻接矩阵 $A$ 要加上单位矩阵 $I_N$？因为在更新节点自身状态时，我们不仅要听取邻居的“意见”，也要保留自己原有的“记忆”。如果不加 $I_N$，节点在更新后就会丢失自身的原有特征。
- **对称归一化（$\tilde{D}^{-\frac{1}{2}} \dots \tilde{D}^{-\frac{1}{2}}$）：**
  - **直觉：** 如果直接把邻居特征相加，度数很大（朋友很多）的节点，其特征值会呈爆炸式增长；度数很小的节点，特征值会非常微弱，这会导致训练极不稳定。
  - **几何意义：** 乘以 $\tilde{D}^{-1}$ 相当于做均值池化（Average Pooling）。但 GCN 使用了 $\tilde{D}^{-\frac{1}{2}} \dots \tilde{D}^{-\frac{1}{2}}$ 这种**对称归一化**。它不仅考虑了目标节点的度（朋友多不多），还考虑了源节点的度（邻居的朋友多不多）。如果你的邻居是一个超级大 V（度数极大），他对你的影响力应该被削弱（因为他的注意力被分散了）；如果你的邻居只有你一个朋友，他对你的影响力权重就会很大。本质上，这是一个图上的**低通滤波器**，使得相邻节点的特征趋于一致（同质性）。

------

### 3. Python 伪代码实现

在深度学习框架（如 PyTorch）中，GCN 层的核心逻辑很简洁。下面用一段伪代码展示矩阵运算过程：

Python

```python
import torch
import torch.nn as nn
import torch.nn.functional as F

class GCNLayer(nn.Module):
    def __init__(self, in_features, out_features):
        super(GCNLayer, self).__init__()
        # 定义可学习的权重矩阵 W
        self.weight = nn.Linear(in_features, out_features, bias=False)

    def forward(self, H, A):
        """
        H: 节点特征矩阵, shape: [N, in_features]
        A: 原始邻接矩阵, shape: [N, N]
        """
        N = A.size(0)
        
        # 1. 添加自环: A_tilde = A + I
        I = torch.eye(N)
        A_tilde = A + I
        
        # 2. 计算度矩阵 D_tilde 及其对称归一化 D^(-1/2)
        # 统计每行的和作为度数
        degree = A_tilde.sum(dim=1) 
        D_inv_sqrt = torch.pow(degree, -0.5)
        # 处理度为0产生的无穷大情况
        D_inv_sqrt[torch.isinf(D_inv_sqrt)] = 0.0 
        # 将一维tensor转换为对角矩阵
        D_inv_sqrt = torch.diag(D_inv_sqrt)
        
        # 3. 对称归一化的邻接矩阵: D^(-1/2) * A_tilde * D^(-1/2)
        norm_A = torch.matmul(torch.matmul(D_inv_sqrt, A_tilde), D_inv_sqrt)
        
        # 4. 特征变换: H * W
        transformed_H = self.weight(H)
        
        # 5. 邻居聚合 (消息传递): norm_A * (H * W)
        output = torch.matmul(norm_A, transformed_H)
        
        return output

# --- 使用示例 ---
# 假设有 5 个节点，输入特征维度为 16，输出特征维度为 8
# gcn_layer = GCNLayer(in_features=16, out_features=8)
# next_H = F.relu(gcn_layer(H, A)) 
```

*(注：在工业界实际应用如 PyG 或 DGL 库中，由于图通常是稀疏的，并不会直接使用稠密矩阵乘法，而是使用稀疏矩阵优化或基于边的消息传递机制，但上述代码最能还原数学公式的本质。)*

------

### 4. 和普通卷积神经网络 (CNN) 的对比

为了更好将你现有的知识迁移过来，我们通过以下表格，从几个核心维度对比传统的 2D CNN 与 GCN：

| **比较维度**       | **传统 CNN (如 ResNet)**                                     | **图卷积网络 GCN**                                           |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| **处理的数据空间** | **欧几里得空间**（Euclidean Data）。数据呈规则网格状排列，如图像的像素。 | **非欧几里得空间**（Non-Euclidean）。数据表现为复杂的拓扑结构，节点连接不规则。 |
| **感受野与邻居**   | **固定大小且有序**。例如 3x3 的卷积核，每个像素严格有 8 个邻居，具有明确的上下左右空间顺序。 | **大小不定且无序**（排列不变性）。一个节点可能有 1 个邻居，也可能有 1000 个邻居，且邻居之间没有空间顺序。 |
| **权重的共享方式** | **空间特征共享**。卷积核的参数（如 3x3=9 个权重）在图像的不同局部位置滑动并共享。 | **变换规则共享**。矩阵 $W^{(l)}$ 在所有节点上共享，图卷积的“空间性”由固定的邻接矩阵 $\tilde{A}$ 提供，而不是通过滑动窗口。 |
| **平移不变性**     | **具备**。图像里的猫无论在左上角还是右下角，CNN 都能识别。   | **不具备传统的平移不变性**，但具备**同构图不变性**（图的节点打乱顺序重新排列，输出结果不受影响）。 |

------

理解了这四步，你就已经掌握了 GCN 的精髓。随着层数的加深，GCN 也会面临一些独有的挑战。

理解 GCN 时，一个常见难点是把矩阵形式和底层的节点交互对应起来。

其实，GCN 的巧妙之处就在于**用优雅的线性代数运算，完美等价了图上的拓扑遍历操作**。我们把这两个问题拆开，用最直白的方式推导一遍。

------

### 1. 为什么 $\tilde{A}H$ 这一乘法等于“收集并相加邻居的特征”？

要理解这一点，我们直接拿一个极简的例子来模拟矩阵乘法。

假设我们有一个只有 3 个节点的图。节点 1 和节点 2 相连，节点 1 和节点 3 相连（节点 2 和 3 不连）。

同时，为了体现 $\tilde{A} = A + I$（带有自环），我们让每个节点也和自己相连。

那么，这个图的带有自环的邻接矩阵 $\tilde{A}$ 如下（有连接就是 1，没连接就是 0）：

$$\tilde{A} = \left[\begin{array}{ccc} 1 & 1 & 1 \\ 1 & 1 & 0 \\ 1 & 0 & 1 \end{array}\right]$$

*(注：第一行代表节点 1 连接了 1, 2, 3；第二行代表节点 2 连接了 1, 2；第三行代表节点 3 连接了 1, 3)*

假设每个节点有 2 个特征，特征矩阵 $H$ 如下：

$$H = \left[\begin{array}{cc} h_{11} & h_{12} \\ h_{21} & h_{22} \\ h_{31} & h_{32} \end{array}\right]$$

*(注：第一行是节点 1 的特征向量，第二行是节点 2 的，以此类推)*

现在，我们执行矩阵乘法 $\tilde{A} \times H$：

$$\tilde{A}H = \left[\begin{array}{ccc} 1 & 1 & 1 \\ 1 & 1 & 0 \\ 1 & 0 & 1 \end{array}\right] \left[\begin{array}{cc} h_{11} & h_{12} \\ h_{21} & h_{22} \\ h_{31} & h_{32} \end{array}\right] = \left[\begin{array}{cc} 1\cdot h_{11} + 1\cdot h_{21} + 1\cdot h_{31} & 1\cdot h_{12} + 1\cdot h_{22} + 1\cdot h_{32} \\ 1\cdot h_{11} + 1\cdot h_{21} + 0\cdot h_{31} & 1\cdot h_{12} + 1\cdot h_{22} + 0\cdot h_{32} \\ 1\cdot h_{11} + 0\cdot h_{21} + 1\cdot h_{31} & 1\cdot h_{12} + 0\cdot h_{22} + 1\cdot h_{32} \end{array}\right]$$

**观察结果矩阵的每一行：**

- **第一行（节点 1 的新特征）：** 变成了节点 1、2、3 原特征的直接相加。这正好对应节点 1 的邻居（包括自己）。
- **第二行（节点 2 的新特征）：** 变成了节点 1、2 原特征的相加（因为它不连节点 3，所以节点 3 的权重是 0）。

**结论：** 邻接矩阵 $\tilde{A}$ 中的 `1` 就像是一个个“开关”。当 $\tilde{A}$ 乘上 $H$ 时，矩阵乘法的行列内积操作，天然地把与目标节点相连的邻居节点的特征“筛选”出来并进行了“求和”。

------

### 2. 深入理解度矩阵 $\tilde{D}$ 与归一化

上面的 $\tilde{A}H$ 虽然实现了“收集并相加”，但带来了一个致命问题：如果节点 1 有 1000 个邻居，节点 2 只有 1 个邻居，那么节点 1 的特征值相加后会比节点 2 大几千倍，导致神经网络梯度爆炸。因此我们需要**归一化**。

#### A. 为什么乘以 $\tilde{D}^{-1}$ 相当于做均值池化（Average Pooling）？

度矩阵 $\tilde{D}$ 是一个对角矩阵，对角线上的数字代表每个节点的“度数”（即邻居个数 + 自己）。

在矩阵代数中，**对角矩阵的逆矩阵 $\tilde{D}^{-1}$，就是将其对角线上的元素取倒数**：

$$\tilde{D}^{-1} = \left[\begin{array}{ccc} \frac{1}{d_1} & 0 & 0 \\ 0 & \frac{1}{d_2} & 0 \\ 0 & 0 & \frac{1}{d_3} \end{array}\right]$$

如果我们计算 $\tilde{D}^{-1} (\tilde{A}H)$：

矩阵左乘一个对角矩阵，相当于**把目标矩阵的每一行乘上对角矩阵对应的元素**。

也就是说，节点 1 刚刚相加完的庞大特征，会被乘以 $\frac{1}{d_1}$（除以它的邻居总数）。

“求和”后再“除以总数”，这在数学上正是**求平均值（均值池化）**的定义。

#### B. 矩阵的 -1/2 次方是什么？

因为 $\tilde{D}$ 是对角矩阵，对它进行任何幂运算都极其简单：**只需要对它对角线上的每一个元素做相同的幂运算即可**。

所以，$\tilde{D}^{-\frac{1}{2}}$ 就是把对角线上的“度数”先开根号，再取倒数：

$$\tilde{D}^{-\frac{1}{2}} = \left[\begin{array}{ccc} \frac{1}{\sqrt{d_1}} & 0 & 0 \\ 0 & \frac{1}{\sqrt{d_2}} & 0 \\ 0 & 0 & \frac{1}{\sqrt{d_3}} \end{array}\right]$$

#### C. 什么是对称归一化 ($\tilde{D}^{-\frac{1}{2}} \tilde{A} \tilde{D}^{-\frac{1}{2}}$)？

如果仅仅使用 $\tilde{D}^{-1}\tilde{A}$（求平均），我们只考虑了“接收节点”的度数。但 GCN 的作者使用了 $\tilde{D}^{-\frac{1}{2}} \tilde{A} \tilde{D}^{-\frac{1}{2}}$，这就是所谓的**对称归一化**。

我们可以把这个式子拆解来看，对于图中的任意一条边（连接节点 $i$ 和节点 $j$），经过对称归一化后，这条边传递特征时的权重系数从原本的 $1$ 变成了：

$$\frac{1}{\sqrt{d_i} \cdot \sqrt{d_j}}$$

这个公式可以从接收方和发送方两个角度理解：

1. **$\frac{1}{\sqrt{d_i}}$ 的作用（接收方视角）：** 和均值池化类似，如果我（节点 $i$）的邻居很多，我接收到的信息总量需要被压制，防止我的特征值爆炸。
2. **$\frac{1}{\sqrt{d_j}}$ 的作用（发送方视角）：** 如果我的邻居（节点 $j$）是一个超级节点（比如微博大V，有十万个粉丝），那么他发出的信息会被分散到十万个节点上。因此，他对我的实质影响力应该被削弱。相反，如果节点 $j$ 只有我这一个朋友，那么他对我的影响力就会非常大。

对称归一化同时考虑了发送方和接收方的连接状态，使得整个图在消息传递时更加平滑和稳定。

------

这就是 GCN 公式中看似枯燥的矩阵运算背后隐藏的图拓扑逻辑。

在理解了 GCN 通过对称归一化（$\frac{1}{\sqrt{d_i d_j}}$）来固定分配邻居权重的机制后，图注意力网络（Graph Attention Networks, GAT）的出现就显得顺理成章了。GAT 解决的是 GCN 的一个核心痛点：**GCN 认为图中节点之间的连接权重仅仅取决于它们的度数（拓扑结构），而 GAT 认为权重应该由节点自身的特征内容动态决定。**

接下来仍从公式、直觉、代码和模型对比四个方面整理 Veličković 等人在 2018 年提出的经典 GAT 模型。

------

### 1. 数学原理 / 公式

GAT 的核心思想是为每个节点及其邻居计算一个**注意力分数（Attention Score）**，并根据这个分数来进行特征的加权求和。其逐层更新的数学过程可以分为以下三个步骤：

**第一步：特征线性变换**

首先对所有节点的特征进行一次共享的线性映射，将节点特征从当前维度转换到更高的表达维度：

$$z_i = W h_i$$

**第二步：计算注意力系数（Attention Coefficients）**

对于图中的任意一条边（节点 $i$ 到其邻居节点 $j$），计算它们之间的未归一化注意力分数 $e_{ij}$。GAT 通过将两者的特征拼接，并点乘一个可学习的权重向量 $\vec{a}$，再经过 LeakyReLU 激活函数来实现：

$$e_{ij} = \text{LeakyReLU}(\vec{a}^T [W h_i \| W h_j])$$

*(注：$\|$ 表示向量拼接操作)*

**第三步：Softmax 归一化与特征聚合**

为了让不同节点的邻居权重具有可比性，在节点 $i$ 的所有邻居（集合 $\mathcal{N}_i$，包含节点 $i$ 自己）范围内，使用 Softmax 函数对 $e_{ij}$ 进行归一化，得到最终的注意力权重 $\alpha_{ij}$：

$$\alpha_{ij} = \text{softmax}_j(e_{ij}) = \frac{\exp(e_{ij})}{\sum_{k \in \mathcal{N}_i} \exp(e_{ik})}$$

最后，利用这些动态计算出的权重 $\alpha_{ij}$，对邻居的特征进行加权求和，并通过非线性激活函数 $\sigma$，得到节点 $i$ 的新特征：

$$h_i^{(l+1)} = \sigma \left( \sum_{j \in \mathcal{N}_i} \alpha_{ij} W h_j \right)$$

*(注：实际应用中，GAT 通常会引入**多头注意力（Multi-head Attention）**，即并行执行上述过程 $K$ 次，然后将结果拼接或求平均，以稳定训练过程。)*

------

### 2. 公式所代表的几何含义 / 数学直觉

GAT 的数学公式非常直观，它本质上是一个**“相亲双向选择”**的过程：

- **拼接与打分 ($[W h_i \| W h_j]$ 与 $\vec{a}^T$)：**
  - **直觉：** 在 GCN 中，张三（度数 10）传给李四（度数 5）的信息权重永远是固定的。但在 GAT 中，我们把张三的特征和李四的特征**拼接（$\|$）**在一起，这代表我们在同时审视这两个人的特质。
  - **几何意义：** 权重向量 $\vec{a}$ 可以看作是一个超平面。它在拼接后的高维特征空间中，评估张三和李四的特征组合是否“匹配”或“重要”。如果两者的特征组合在这个超平面上的投影值很大，说明 $j$ 对 $i$ 很重要。
- **LeakyReLU 激活：**
  - **直觉：** 相比于普通的 ReLU，LeakyReLU 允许微小的负梯度通过。这意味着即使张三和李四目前看起来“非常不匹配”（得分为负），我们也不一棍子打死（置为 0），而是保留微弱的联系，让网络在反向传播时有机会修正这个看法。
- **Masked Softmax (局部归一化)：**
  - **直觉：** 一个人（节点 $i$）的注意力是有限的（总和为 1）。Softmax 就是在做**注意力的分配**。
  - **几何意义：** 与全局 Softmax 不同，这里的求和底数仅仅是 $k \in \mathcal{N}_i$（仅仅是节点 $i$ 的真实邻居）。这被称为 **Masked Attention（掩码注意力）**。它强制网络只能把注意力分配给图拓扑结构中实际相连的节点，将图的结构信息（先验知识）硬编码到了注意力分配中。

------

### 3. Python 伪代码实现

下面用一段基于稠密矩阵的 PyTorch 伪代码展示 GAT 中的“两两特征拼接与打分”和“掩码操作”：

```python
import torch
import torch.nn as nn
import torch.nn.functional as F

class GATLayer(nn.Module):
    def __init__(self, in_features, out_features):
        super(GATLayer, self).__init__()
        # 特征变换矩阵 W
        self.W = nn.Linear(in_features, out_features, bias=False)
        # 注意力打分向量 a (维度是输出特征维度的 2 倍，因为要拼接两个节点的特征)
        self.a = nn.Parameter(torch.empty(size=(2 * out_features, 1)))
        nn.init.xavier_uniform_(self.a.data)
        self.leakyrelu = nn.LeakyReLU(0.2)

    def forward(self, H, adj):
        """
        H: 节点特征矩阵, shape [N, in_features]
        adj: 图的邻接矩阵, shape [N, N] (包含自环)
        """
        N = H.size(0)
        
        # 1. 线性变换: Wh shape [N, out_features]
        Wh = self.W(H) 
        
        # 2. 准备两两拼接的特征组合 (巧妙利用广播机制)
        # Wh_repeated_in_chunks shape: [N, N, out_features]
        Wh_repeated_in_chunks = Wh.repeat_interleave(N, dim=0).view(N, N, -1)
        # Wh_repeated_alternating shape: [N, N, out_features]
        Wh_repeated_alternating = Wh.repeat(N, 1).view(N, N, -1)
        
        # 将节点 i 和 节点 j 的特征在最后一维拼接: shape [N, N, 2*out_features]
        all_combinations_matrix = torch.cat([Wh_repeated_in_chunks, Wh_repeated_alternating], dim=2)
        
        # 3. 计算未归一化的注意力得分 e_ij
        # shape 变为 [N, N, 1]，然后 squeeze 为 [N, N]
        e = self.leakyrelu(torch.matmul(all_combinations_matrix, self.a).squeeze(2))
        
        # 4. 掩码操作 (Masked Attention)
        # 邻接矩阵中为 0 的地方（非邻居），替换为极小的负数（-9e15），这样 softmax 后权重接近 0
        zero_vec = -9e15 * torch.ones_like(e)
        attention = torch.where(adj > 0, e, zero_vec)
        
        # 5. Softmax 归一化 (每一行之和为 1)
        attention = F.softmax(attention, dim=1)
        
        # 6. 特征加权聚合: alpha * Wh
        # [N, N] * [N, out_features] -> [N, out_features]
        h_prime = torch.matmul(attention, Wh) 
        
        return F.elu(h_prime)

# --- 使用示例 ---
# gat_layer = GATLayer(in_features=16, out_features=8)
# next_H = gat_layer(H, adj) 
```

------

### 4. 和普通 Attention（如 Transformer）的对比

GAT 和自然语言处理中 Transformer 所使用的自注意力机制（Self-Attention）同宗同源，但针对图数据做了极具针对性的改造。它们的对比如下：

| **比较维度**              | **普通 Attention (Transformer)**                             | **图注意力网络 (GAT)**                                       |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| **拓扑结构的假设**        | **全连接图（Fully Connected Graph）**。序列中的每个 Token 都会计算与所有其他 Token 的注意力分数。它假设没有先验的连接关系。 | **稀疏图（Sparse Graph）**。节点 $i$ 仅仅计算与图中它的邻居节点（$\mathcal{N}_i$）的注意力分数。它强制利用了图的先验拓扑结构。 |
| **计算复杂度**            | **$\mathcal{O}(N^2)$**。因为需要计算两两之间的得分，节点数量 $N$ 大时计算量很高。 | **$\mathcal{O}(|V| + |E|)$**。只计算有边连接的节点对。在通常的稀疏图中，计算量远小于 $\mathcal{O}(N^2)$。 |
| **位置 / 结构信息的注入** | **必须依赖显式的位置编码（Positional Encoding）**。因为全连接图本身没有顺序或局部结构的天然概念。 | **不需要显式的结构编码**。图的邻接矩阵（掩码操作）自然而然地将拓扑结构编码到了模型内部。 |
| **打分机制的设计**        | 通常采用 **Scaled Dot-Product Attention**，通过定义三组不同的权重 $W_Q, W_K, W_V$（Query, Key, Value），利用点积计算相似度。 | 原始论文采用 **Additive Attention（加性注意力）**。使用同一组共享权重 $W$，将特征拼接后通过向量 $\vec{a}$ 和非线性激活函数映射为标量得分。 |

Transformer 里的 Attention 通过让所有数据互相计算注意力来学习潜在结构；GAT 则直接利用已有的图结构（边）作为掩码，在这个约束下计算局部注意力权重。

